# OpenHand для Windows

Нативная Windows-оболочка повторяет возможности `macos/`: загружает полностью
локальную production-сборку интерфейса, предоставляет Web Serial-совместимый
мост к COM-портам и использует системные диалоги Windows для файлов.

## Возможности

- WinForms + Microsoft Edge WebView2 без локального HTTP-сервера;
- COM-порты, скорости 9600, 115200 и 250000 бод;
- запись и непрерывное чтение, DTR/RTS, уведомление об отключении;
- безопасный локальный origin `https://app.openhand.local`;
- сохранение PDF-настроек, G-code, `.gfont` и других экспортов;
- открытие и drag-and-drop `.gcode`, `.nc`, `.tap`;
- внешние ссылки открываются в браузере, остальные переходы блокируются;
- per-monitor DPI, локальное хранилище WebView2 и нативная иконка.

## Сборка

Из корня проекта:

```powershell
npm install
npm run windows:build
```

Результаты:

- `windows/build/OpenHand-win-x64/` — переносимая self-contained версия;
- `windows/build/OpenHand-win-x64.zip` — готовый архив;
- `windows/build/OpenHand-Setup-win-x64.exe` — установщик, если найден Inno
  Setup 6.

Для ARM64 используйте `npm run windows:build:arm64`. Для быстрой компиляции из
Visual Studio или CLI сначала выполните `npm run build`, затем:

```powershell
dotnet build windows/OpenHand.csproj
```

## Системные требования

- Windows 10 1809 или новее;
- Microsoft Edge WebView2 Runtime;
- драйвер подключённого USB-UART/плоттера.

Self-contained release содержит .NET Runtime. WebView2 Evergreen уже установлен
в актуальных Windows 10/11; если он был удалён, приложение покажет понятное
сообщение вместо пустого окна.

## Проверка с устройством

1. Подключите плоттер и убедитесь, что COM-порт появился в Диспетчере устройств.
2. Запустите OpenHand и раскройте панель «Плоттер».
3. Нажмите «Подключить», выберите COM-порт и профиль контроллера.
4. Проверьте перемещение, установку нуля и подъём пера до отправки задания.

Один COM-порт может быть открыт только одной программой. Если доступ запрещён,
закройте serial monitor, Arduino IDE или другую программу, использующую порт.
