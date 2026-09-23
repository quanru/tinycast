import AppKit
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 3 || CommandLine.arguments.count == 5 else {
    FileHandle.standardError.write(
        Data("usage: helper <visible-window-count|window-bounds> <bundle-id>\n".utf8))
    exit(2)
}

let command = CommandLine.arguments[1]
let bundleID = CommandLine.arguments[2]

if command == "mouse-down" || command == "mouse-up" {
    guard
        CommandLine.arguments.count == 5,
        let x = Double(CommandLine.arguments[3]),
        let y = Double(CommandLine.arguments[4])
    else {
        FileHandle.standardError.write(Data("mouse event needs numeric x and y\n".utf8))
        exit(2)
    }
    let type: CGEventType = command == "mouse-down" ? .leftMouseDown : .leftMouseUp
    let event = CGEvent(
        mouseEventSource: nil,
        mouseType: type,
        mouseCursorPosition: CGPoint(x: x, y: y),
        mouseButton: .left)
    guard let event else { exit(1) }
    event.post(tap: .cghidEventTap)
    exit(0)
}

guard CommandLine.arguments.count == 3,
      ["visible-window-count", "window-bounds"].contains(command) else {
    FileHandle.standardError.write(Data("unknown command: \(command)\n".utf8))
    exit(2)
}

guard let application = NSRunningApplication.runningApplications(
    withBundleIdentifier: bundleID
).first else {
    print(0)
    exit(0)
}

let windows = CGWindowListCopyWindowInfo(
    [.optionOnScreenOnly, .excludeDesktopElements],
    kCGNullWindowID
) as? [[String: Any]] ?? []

struct WindowInfo {
    let id: Int
    let bounds: CGRect
}

let visibleWindows = windows.compactMap { window -> WindowInfo? in
    guard
        (window[kCGWindowOwnerPID as String] as? Int32) == application.processIdentifier,
        let id = window[kCGWindowNumber as String] as? Int,
        let bounds = window[kCGWindowBounds as String] as? [String: CGFloat],
        let width = bounds["Width"],
        let height = bounds["Height"]
    else { return nil }
    let alpha = window[kCGWindowAlpha as String] as? CGFloat ?? 1
    guard alpha > 0 && width > 100 && height > 100 else { return nil }
    let x = bounds["X"] ?? 0
    let y = bounds["Y"] ?? 0
    return WindowInfo(id: id, bounds: CGRect(x: x, y: y, width: width, height: height))
}

if command == "visible-window-count" {
    print(visibleWindows.count)
} else if let window = visibleWindows.max(by: {
    $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height
}) {
    let value: [String: Any] = [
        "id": window.id,
        "x": window.bounds.minX,
        "y": window.bounds.minY,
        "width": window.bounds.width,
        "height": window.bounds.height,
    ]
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
} else {
    print("null")
}
