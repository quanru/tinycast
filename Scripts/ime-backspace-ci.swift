import AppKit
import ApplicationServices
import Carbon.HIToolbox
import Foundation

private func property<Value>(_ key: CFString, of source: TISInputSource) -> Value? {
    guard let value = TISGetInputSourceProperty(source, key) else { return nil }
    return Unmanaged<AnyObject>.fromOpaque(value).takeUnretainedValue() as? Value
}

private func selectPinyin() throws {
    guard let raw = TISCreateInputSourceList(nil, true)?.takeRetainedValue() else {
        throw NSError(domain: "TinycastIMEBackspaceCI", code: 1)
    }
    let sources = raw as NSArray
    let candidates = sources.compactMap { value -> (TISInputSource, String, String)? in
        let source = value as! TISInputSource
        guard let identifier: String = property(kTISPropertyInputSourceID, of: source),
            let name: String = property(kTISPropertyLocalizedName, of: source)
        else { return nil }
        return (source, identifier, name)
    }
    let pinyinCandidates = candidates.filter {
        $0.1.contains("SCIM.ITABC") || $0.2.localizedCaseInsensitiveContains("Pinyin")
            || $0.2.contains("拼音")
    }
    guard pinyinCandidates.isEmpty == false else {
        let inventory = candidates.map { "\($0.1)\t\($0.2)" }.joined(separator: "\n")
        throw NSError(
            domain: "TinycastIMEBackspaceCI", code: 2,
            userInfo: [NSLocalizedDescriptionKey: "No Pinyin input source found:\n\(inventory)"])
    }
    for candidate in pinyinCandidates {
        let enableStatus = TISEnableInputSource(candidate.0)
        guard enableStatus == noErr else { continue }
        let selectStatus = TISSelectInputSource(candidate.0)
        guard selectStatus == noErr else { continue }
        print("\(candidate.1)\t\(candidate.2)")
        return
    }
    let inventory = pinyinCandidates.map { "\($0.1)\t\($0.2)" }.joined(separator: "\n")
    throw NSError(
        domain: "TinycastIMEBackspaceCI", code: 3,
        userInfo: [NSLocalizedDescriptionKey: "Could not select a Pinyin source:\n\(inventory)"])
}

private func attribute(_ name: String, of element: AXUIElement) -> Any? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
        return nil
    }
    return value
}

private func collectScreenText(
    from element: AXUIElement, depth: Int = 0, result: inout [String]
) {
    guard depth <= 8, result.count < 300 else { return }
    for key in [
        kAXDescriptionAttribute, kAXTitleAttribute, kAXValueAttribute, kAXHelpAttribute,
        kAXRoleDescriptionAttribute
    ] {
        if let value = attribute(key, of: element) as? String, value.isEmpty == false,
            result.contains(value) == false
        {
            result.append(value)
        }
    }
    guard let children = attribute(kAXChildrenAttribute, of: element) as? [AXUIElement] else {
        return
    }
    for child in children {
        collectScreenText(from: child, depth: depth + 1, result: &result)
    }
}

private func focusedField(bundleID: String) throws {
    guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleID).first
    else {
        throw NSError(
            domain: "TinycastIMEBackspaceCI", code: 4,
            userInfo: [NSLocalizedDescriptionKey: "No running application for \(bundleID)"])
    }
    let application = AXUIElementCreateApplication(app.processIdentifier)
    guard let value = attribute(kAXFocusedUIElementAttribute, of: application) else {
        throw NSError(
            domain: "TinycastIMEBackspaceCI", code: 5,
            userInfo: [NSLocalizedDescriptionKey: "No focused element for \(bundleID)"])
    }
    let focused = value as! AXUIElement
    let attributes: [(String, String)] = [
        ("role", kAXRoleAttribute),
        ("description", kAXDescriptionAttribute),
        ("title", kAXTitleAttribute),
        ("placeholder", kAXPlaceholderValueAttribute),
        ("value", kAXValueAttribute)
    ]
    var result: [String: Any] = ["pid": Int(app.processIdentifier)]
    for (name, key) in attributes {
        if let value = attribute(key, of: focused) as? String { result[name] = value }
    }
    var screenText: [String] = []
    collectScreenText(from: application, result: &screenText)
    result["screenText"] = screenText
    let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    print(String(decoding: data, as: UTF8.self))
}

do {
    switch CommandLine.arguments.dropFirst().first {
    case "select-pinyin":
        try selectPinyin()
    case "focused-field":
        guard CommandLine.arguments.count == 3 else {
            throw NSError(
                domain: "TinycastIMEBackspaceCI", code: 6,
                userInfo: [NSLocalizedDescriptionKey: "focused-field requires a bundle id"])
        }
        try focusedField(bundleID: CommandLine.arguments[2])
    default:
        throw NSError(
            domain: "TinycastIMEBackspaceCI", code: 7,
            userInfo: [NSLocalizedDescriptionKey: "Use select-pinyin or focused-field <bundle-id>"])
    }
} catch {
    FileHandle.standardError.write(Data("\(error.localizedDescription)\n".utf8))
    exit(1)
}
