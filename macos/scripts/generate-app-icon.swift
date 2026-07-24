import AppKit
import Foundation

let outputDirectory = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? ".")
let variants: [(name: String, pixels: Int)] = [
    ("icon_16x16.png", 16),
    ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32),
    ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128),
    ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256),
    ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512),
    ("icon_512x512@2x.png", 1_024),
]

func color(_ red: CGFloat, _ green: CGFloat, _ blue: CGFloat, _ alpha: CGFloat = 1) -> NSColor {
    NSColor(
        deviceRed: red / 255,
        green: green / 255,
        blue: blue / 255,
        alpha: alpha
    )
}

func drawIcon(size: Int) throws -> Data {
    guard let bitmap = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: size,
        pixelsHigh: size,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .deviceRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ) else {
        throw CocoaError(.fileWriteUnknown)
    }

    let scale = CGFloat(size) / 1_024
    NSGraphicsContext.saveGraphicsState()
    guard let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw CocoaError(.fileWriteUnknown)
    }
    NSGraphicsContext.current = graphics
    graphics.imageInterpolation = .high
    graphics.cgContext.scaleBy(x: scale, y: scale)
    graphics.cgContext.setShouldAntialias(true)

    let tile = NSBezierPath(
        roundedRect: NSRect(x: 48, y: 48, width: 928, height: 928),
        xRadius: 210,
        yRadius: 210
    )
    color(242, 239, 231).setFill()
    tile.fill()
    color(26, 38, 54).setStroke()
    tile.lineWidth = 34
    tile.stroke()

    let paper = NSBezierPath(
        roundedRect: NSRect(x: 215, y: 205, width: 594, height: 640),
        xRadius: 48,
        yRadius: 48
    )
    color(255, 253, 248).setFill()
    paper.fill()
    color(26, 38, 54).setStroke()
    paper.lineWidth = 24
    paper.stroke()

    color(198, 207, 218).setStroke()
    for y in stride(from: CGFloat(365), through: CGFloat(695), by: 82) {
        let rule = NSBezierPath()
        rule.move(to: NSPoint(x: 285, y: y))
        rule.line(to: NSPoint(x: 735, y: y))
        rule.lineWidth = 16
        rule.lineCapStyle = .round
        rule.stroke()
    }

    let ink = NSBezierPath()
    ink.move(to: NSPoint(x: 300, y: 440))
    ink.curve(
        to: NSPoint(x: 470, y: 525),
        controlPoint1: NSPoint(x: 350, y: 600),
        controlPoint2: NSPoint(x: 405, y: 360)
    )
    ink.curve(
        to: NSPoint(x: 705, y: 470),
        controlPoint1: NSPoint(x: 545, y: 660),
        controlPoint2: NSPoint(x: 610, y: 360)
    )
    color(37, 99, 235).setStroke()
    ink.lineWidth = 34
    ink.lineCapStyle = .round
    ink.lineJoinStyle = .round
    ink.stroke()

    let penBody = NSBezierPath()
    penBody.move(to: NSPoint(x: 620, y: 690))
    penBody.line(to: NSPoint(x: 770, y: 840))
    penBody.line(to: NSPoint(x: 850, y: 760))
    penBody.line(to: NSPoint(x: 700, y: 610))
    penBody.close()
    color(26, 38, 54).setFill()
    penBody.fill()

    let nib = NSBezierPath()
    nib.move(to: NSPoint(x: 620, y: 690))
    nib.line(to: NSPoint(x: 565, y: 565))
    nib.line(to: NSPoint(x: 700, y: 610))
    nib.close()
    color(37, 99, 235).setFill()
    nib.fill()

    let nibHole = NSBezierPath(ovalIn: NSRect(x: 620, y: 630, width: 35, height: 35))
    color(255, 253, 248).setFill()
    nibHole.fill()

    graphics.flushGraphics()
    NSGraphicsContext.restoreGraphicsState()

    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        throw CocoaError(.fileWriteUnknown)
    }
    return data
}

try FileManager.default.createDirectory(
    at: outputDirectory,
    withIntermediateDirectories: true
)
for variant in variants {
    let data = try drawIcon(size: variant.pixels)
    try data.write(to: outputDirectory.appendingPathComponent(variant.name), options: .atomic)
}
