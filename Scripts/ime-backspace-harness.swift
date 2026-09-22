import AppKit
import Carbon.HIToolbox

// Minimal stand-ins for the two PaletteEscapeAction inputs unused by this reproducer.
enum PaletteMode {
    case launcher
    case extensionCommand
}

enum EscapeKeyBehavior {
    case close
    case navigateBackOrClose
}

private enum HarnessBehavior: String {
    case before
    case after
}

private final class HarnessPanel: NSPanel {
    private let behavior: HarnessBehavior
    private let field = NSTextField(frame: .zero)
    private var isChat = false

    init(behavior: HarnessBehavior) {
        self.behavior = behavior
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 620, height: 120),
            styleMask: [.titled, .closable], backing: .buffered, defer: false)
        title = "Tinycast IME Backspace \(behavior.rawValue)"
        isReleasedWhenClosed = false

        field.font = .systemFont(ofSize: 22)
        field.translatesAutoresizingMaskIntoConstraints = false
        let content = NSView(frame: contentRect(forFrameRect: frame))
        content.addSubview(field)
        NSLayoutConstraint.activate([
            field.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: 24),
            field.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -24),
            field.centerYAnchor.constraint(equalTo: content.centerYAnchor),
            field.heightAnchor.constraint(equalToConstant: 44)
        ])
        contentView = content
        showLauncher()
    }

    override func sendEvent(_ event: NSEvent) {
        guard event.type == .keyDown else {
            super.sendEvent(event)
            return
        }
        let bareModifiers = event.modifierFlags.isDisjoint(with: [.command, .option, .control, .shift])
        if Int(event.keyCode) == kVK_F12 {
            showLauncher()
            return
        }
        if Int(event.keyCode) == kVK_Tab, isChat == false {
            showChat()
            return
        }
        if Int(event.keyCode) == kVK_Delete, bareModifiers, shouldNavigateBack() {
            showLauncher()
            return
        }
        super.sendEvent(event)
    }

    private func shouldNavigateBack() -> Bool {
        guard isChat else { return false }
        let editor = field.currentEditor() as? NSTextView
        let isComposing = editor?.hasMarkedText() == true
        // SwiftUI does not commit marked text to the query binding. Model that boundary explicitly.
        let query = isComposing ? "" : field.stringValue
        if behavior == .after,
            PaletteEscapeAction.fieldOwnsBackspace(
                query: query, isEditingField: false, isComposing: isComposing)
        {
            return false
        }
        return query.isEmpty
    }

    private func showLauncher() {
        isChat = false
        configureField(placeholder: "Search for apps and commands")
    }

    private func showChat() {
        isChat = true
        configureField(placeholder: "Ask anything")
    }

    private func configureField(placeholder: String) {
        field.stringValue = ""
        field.placeholderString = placeholder
        field.setAccessibilityLabel(placeholder)
        makeKeyAndOrderFront(nil)
        makeFirstResponder(field)
        NSApp.activate(ignoringOtherApps: true)
    }
}

private final class HarnessDelegate: NSObject, NSApplicationDelegate {
    private var panel: HarnessPanel?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let value = ProcessInfo.processInfo.environment["EVIDENCE_LABEL"] ?? "after"
        guard let behavior = HarnessBehavior(rawValue: value) else {
            fatalError("EVIDENCE_LABEL must be before or after")
        }
        panel = HarnessPanel(behavior: behavior)
    }
}

@main
private enum IMEBackspaceHarness {
    static func main() {
        let application = NSApplication.shared
        let delegate = HarnessDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
        _ = delegate
    }
}
