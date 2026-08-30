const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ZIP_ENTRIES = 10_000;
const MAX_ZIP_OUTPUT_BYTES = 64 * 1024 * 1024;

interface ZipEntry {
  method: number;
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

function findDirectory(view: DataView) {
  const minimum = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("В XLSX не найден ZIP-каталог.");
}

async function inflateRaw(bytes: Uint8Array) {
  if (!globalThis.DecompressionStream)
    throw new Error("Эта система не поддерживает распаковку XLSX.");
  const stream = new Blob([bytes.slice().buffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class BoundedZipReader {
  private readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly entries = new Map<string, ZipEntry>();

  constructor(buffer: ArrayBuffer) {
    this.bytes = new Uint8Array(buffer);
    this.view = new DataView(buffer);
    const eocd = findDirectory(this.view);
    const entryCount = this.view.getUint16(eocd + 10, true);
    const directorySize = this.view.getUint32(eocd + 12, true);
    const directoryOffset = this.view.getUint32(eocd + 16, true);
    if (entryCount > MAX_ZIP_ENTRIES)
      throw new Error("В XLSX слишком много файлов.");
    if (directoryOffset + directorySize > eocd)
      throw new Error("Повреждён ZIP-каталог XLSX.");

    let offset = directoryOffset;
    let outputBytes = 0;
    const decoder = new TextDecoder();
    for (let index = 0; index < entryCount; index += 1) {
      if (
        offset + 46 > this.view.byteLength ||
        this.view.getUint32(offset, true) !== CENTRAL_SIGNATURE
      )
        throw new Error("Повреждена запись ZIP-каталога XLSX.");
      const flags = this.view.getUint16(offset + 8, true);
      const method = this.view.getUint16(offset + 10, true);
      const compressedSize = this.view.getUint32(offset + 20, true);
      const uncompressedSize = this.view.getUint32(offset + 24, true);
      const nameLength = this.view.getUint16(offset + 28, true);
      const extraLength = this.view.getUint16(offset + 30, true);
      const commentLength = this.view.getUint16(offset + 32, true);
      const localOffset = this.view.getUint32(offset + 42, true);
      if (
        [compressedSize, uncompressedSize, localOffset].includes(0xffffffff)
      )
        throw new Error("ZIP64 XLSX пока не поддерживается.");
      const end = offset + 46 + nameLength + extraLength + commentLength;
      if (end > this.view.byteLength)
        throw new Error("Имя файла выходит за ZIP-каталог XLSX.");
      const name = decoder.decode(
        this.bytes.subarray(offset + 46, offset + 46 + nameLength),
      );
      outputBytes += uncompressedSize;
      if (outputBytes > MAX_ZIP_OUTPUT_BYTES)
        throw new Error("Распакованный XLSX больше 64 МБ.");
      this.entries.set(name, {
        method,
        flags,
        compressedSize,
        uncompressedSize,
        localOffset,
      });
      offset = end;
    }
  }

  names() {
    return [...this.entries.keys()];
  }

  async read(name: string) {
    const entry = this.entries.get(name);
    if (!entry) return null;
    if (entry.flags & 1) throw new Error("Зашифрованный XLSX не поддерживается.");
    if (![0, 8].includes(entry.method))
      throw new Error("В XLSX используется неподдерживаемое сжатие.");
    const offset = entry.localOffset;
    if (
      offset + 30 > this.view.byteLength ||
      this.view.getUint32(offset, true) !== LOCAL_SIGNATURE
    )
      throw new Error("Повреждён локальный ZIP-заголовок XLSX.");
    const nameLength = this.view.getUint16(offset + 26, true);
    const extraLength = this.view.getUint16(offset + 28, true);
    const start = offset + 30 + nameLength + extraLength;
    const end = start + entry.compressedSize;
    if (end > this.bytes.length)
      throw new Error("Данные файла выходят за границы XLSX.");
    const compressed = this.bytes.subarray(start, end);
    const output =
      entry.method === 0 ? compressed.slice() : await inflateRaw(compressed);
    if (output.length !== entry.uncompressedSize)
      throw new Error("Размер распакованного файла XLSX не совпал.");
    return output;
  }
}
