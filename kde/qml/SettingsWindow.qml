// Settings window (tray menu → Settings, or copy-addict --settings).
import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Layouts
import org.kde.kirigami as Kirigami

Kirigami.ApplicationWindow {
    id: root
    title: i18n("copy-addict settings")
    width: 560
    height: 720
    minimumWidth: 460
    minimumHeight: 420
    pageStack.initialPage: Kirigami.ScrollablePage {
        title: i18n("Settings")

        Kirigami.FormLayout {
            Kirigami.Separator { Kirigami.FormData.isSection: true; Kirigami.FormData.label: i18n("History") }
            QQC2.SpinBox {
                Kirigami.FormData.label: i18n("Items to keep:")
                from: 1
                to: 1000
                value: settings.historyLength
                onValueModified: settings.historyLength = value
            }
            QQC2.SpinBox {
                Kirigami.FormData.label: i18n("Forget items older than (minutes):")
                from: 0
                to: 525600
                stepSize: 30
                value: settings.historyMinutes
                onValueModified: settings.historyMinutes = value
            }
            QQC2.Label {
                text: i18n("0 keeps items until the limit above is reached. Pinned and tagged items never expire.")
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
                opacity: 0.7
                Layout.maximumWidth: 320
            }
            QQC2.ComboBox {
                Kirigami.FormData.label: i18n("When you log in again:")
                textRole: "text"
                valueRole: "value"
                model: [
                    { text: i18n("Keep everything"), value: "keep-all" },
                    { text: i18n("Keep only pinned and tagged items"), value: "keep-pinned-and-tagged" },
                    { text: i18n("Start with an empty history"), value: "clear" },
                ]
                Component.onCompleted: currentIndex = indexOfValue(settings.onNewSession)
                onActivated: settings.onNewSession = currentValue
            }
            QQC2.CheckBox {
                Kirigami.FormData.label: i18n("Protection:")
                text: i18n("Protect pinned items")
                checked: settings.protectPinned
                onToggled: settings.protectPinned = checked
            }
            QQC2.CheckBox {
                text: i18n("Protect tagged items")
                checked: settings.protectTagged
                onToggled: settings.protectTagged = checked
            }

            Kirigami.Separator { Kirigami.FormData.isSection: true; Kirigami.FormData.label: i18n("Behavior") }
            QQC2.CheckBox {
                text: i18n("Paste when an item is chosen")
                checked: settings.pasteOnSelect
                onToggled: settings.pasteOnSelect = checked
            }
            QQC2.CheckBox {
                text: i18n("Play a sound when something is copied")
                checked: settings.copySound
                onToggled: settings.copySound = checked
            }
            QQC2.CheckBox {
                text: i18n("Show the tray icon")
                checked: settings.showTrayIcon
                onToggled: settings.showTrayIcon = checked
            }

            Kirigami.Separator { Kirigami.FormData.isSection: true; Kirigami.FormData.label: i18n("Privacy") }
            QQC2.CheckBox {
                text: i18n("Incognito mode")
                checked: settings.incognito
                onToggled: settings.incognito = checked
            }
            QQC2.TextField {
                Kirigami.FormData.label: i18n("Ignore copies from these apps:")
                placeholderText: i18n("keepassxc, org.gnome.seahorse")
                text: settings.excludedApps
                onEditingFinished: settings.excludedApps = text
                Layout.preferredWidth: 280
            }
            QQC2.Label {
                text: i18n("Window classes, separated by commas. Password managers are always ignored when they mark their copies.")
                wrapMode: Text.Wrap
                font: Kirigami.Theme.smallFont
                opacity: 0.7
                Layout.maximumWidth: 320
            }

            Kirigami.Separator { Kirigami.FormData.isSection: true; Kirigami.FormData.label: i18n("Appearance") }
            QQC2.ComboBox {
                Kirigami.FormData.label: i18n("Position on screen:")
                textRole: "text"
                valueRole: "value"
                model: [
                    { text: i18n("Bottom"), value: "bottom" },
                    { text: i18n("Top"), value: "top" },
                ]
                Component.onCompleted: currentIndex = indexOfValue(settings.position)
                onActivated: settings.position = currentValue
            }
            QQC2.SpinBox {
                Kirigami.FormData.label: i18n("Card width:")
                from: 150
                to: 600
                stepSize: 10
                value: settings.itemWidth
                onValueModified: settings.itemWidth = value
            }
            QQC2.SpinBox {
                Kirigami.FormData.label: i18n("Card height:")
                from: 100
                to: 500
                stepSize: 10
                value: settings.itemHeight
                onValueModified: settings.itemHeight = value
            }
            QQC2.ComboBox {
                Kirigami.FormData.label: i18n("Images:")
                textRole: "text"
                valueRole: "value"
                model: [
                    { text: i18n("Fill the card (crop)"), value: "cover" },
                    { text: i18n("Show the whole image"), value: "contain" },
                ]
                Component.onCompleted: currentIndex = indexOfValue(settings.imageFit)
                onActivated: settings.imageFit = currentValue
            }

            Kirigami.Separator { Kirigami.FormData.isSection: true; Kirigami.FormData.label: i18n("Shortcuts") }
            QQC2.Label {
                Kirigami.FormData.label: i18n("Open the clipboard history:")
                text: app.shortcutLabel || i18n("None")
            }
            QQC2.Label {
                Kirigami.FormData.label: i18n("Toggle incognito mode:")
                text: app.incognitoShortcutLabel || i18n("None")
            }
            QQC2.Button {
                text: i18n("Change shortcuts…")
                icon.name: "configure-shortcuts"
                onClicked: app.configureShortcuts()
            }

            Kirigami.Separator { Kirigami.FormData.isSection: true }
            QQC2.Label {
                text: i18n("copy-addict %1", app.version)
                opacity: 0.6
            }
        }
    }
}
