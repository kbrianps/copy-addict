// Dark look modelled on Copyous (GNOME palette).
pragma Singleton
import QtQuick

QtObject {
    readonly property real base: Qt.application.font.pointSize > 0 ? Qt.application.font.pointSize : 11
    function pt(scale) { return base * scale }

    readonly property color backdrop: Qt.rgba(0, 0, 0, 0.18)
    readonly property color panel: "#2b2b2f"
    readonly property color panelBorder: Qt.rgba(1, 1, 1, 0.09)
    readonly property color card: "#3a3a3f"
    readonly property color cardHover: "#424248"
    readonly property color cardSelected: "#3c4250"
    readonly property color cardSelectedHover: "#434a59"
    readonly property color selectionBorder: "#78aeed"
    readonly property color accent: "#3584e4"
    readonly property color accentHover: "#4a90e8"
    readonly property color destructive: "#c01c28"
    readonly property color destructiveHover: "#d42a36"
    readonly property color menu: "#303035"
    readonly property color menuBorder: Qt.rgba(1, 1, 1, 0.10)
    readonly property color text: "#ffffff"
    readonly property color text92: Qt.rgba(1, 1, 1, 0.92)
    readonly property color text85: Qt.rgba(1, 1, 1, 0.85)
    readonly property color text70: Qt.rgba(1, 1, 1, 0.70)
    readonly property color text65: Qt.rgba(1, 1, 1, 0.65)
    readonly property color text60: Qt.rgba(1, 1, 1, 0.60)
    readonly property color text55: Qt.rgba(1, 1, 1, 0.55)
    readonly property color text50: Qt.rgba(1, 1, 1, 0.50)
    readonly property color text45: Qt.rgba(1, 1, 1, 0.45)
    readonly property color link: "#99c1f1"
    readonly property color current: "#78aeed"
    readonly property color fill08: Qt.rgba(1, 1, 1, 0.08)
    readonly property color fill10: Qt.rgba(1, 1, 1, 0.10)
    readonly property color fill14: Qt.rgba(1, 1, 1, 0.14)
    readonly property color fill16: Qt.rgba(1, 1, 1, 0.16)
    readonly property color fill18: Qt.rgba(1, 1, 1, 0.18)
    readonly property color checked: Qt.rgba(53 / 255, 132 / 255, 228 / 255, 0.35)
    readonly property string mono: "monospace"
}
