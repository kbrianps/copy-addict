// The nine tag colours as dots; the current one has a check mark.
import QtQuick

Row {
    id: row
    property string current
    signal picked(string tagId)
    spacing: 7
    padding: 6
    leftPadding: 8

    Repeater {
        model: app.tags
        Rectangle {
            required property var modelData
            required property int index
            width: 22
            height: 22
            radius: 11
            color: modelData.color
            border.width: 2
            border.color: row.current === modelData.id ? Theme.text : (dotHover.hovered ? Qt.rgba(1, 1, 1, 0.6) : "transparent")
            SymbolicIcon {
                anchors.centerIn: parent
                visible: row.current === modelData.id
                name: "object-select-symbolic"
                size: 12
            }
            HoverHandler { id: dotHover; cursorShape: Qt.PointingHandCursor }
            MouseArea { anchors.fill: parent; onClicked: row.picked(modelData.id) }
        }
    }
}
