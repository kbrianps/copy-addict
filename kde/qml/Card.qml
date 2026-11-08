// One card per clipboard entry: header (type, title, time, buttons) and a preview.
import QtQuick
import QtQuick.Controls.Basic as B
import QtQuick.Layouts

Item {
    id: card
    required property int index
    required property string itemId
    required property string type
    required property string displayTitle
    required property string customTitle
    required property double time
    required property bool pinned
    required property string tag
    required property string tagColor
    required property bool isProtected
    required property var view
    required property string codeHtml

    property bool selected: false
    property double now: Date.now()
    property bool playing: true
    readonly property bool editingTitle: titleEditor.visible
    readonly property color accent: tagColor !== "" ? tagColor : Theme.text85

    signal chosen(bool shift, bool ctrl)
    signal menuRequested(real x, real y)       // in card coordinates; -1 = default position
    signal pinToggled()
    signal deleteRequested()
    signal titleEditFinished(bool save, string title)

    width: settings.itemWidth
    height: settings.itemHeight

    // A tag shows as a coloured top edge.
    Rectangle {
        anchors.fill: parent
        radius: 12
        color: card.tagColor !== "" ? card.tagColor : "transparent"
    }
    Rectangle {
        anchors.fill: parent
        anchors.topMargin: card.tagColor !== "" ? 3 : 0
        radius: 12
        color: card.selected ? (hover.hovered ? Theme.cardSelectedHover : Theme.cardSelected)
                             : (hover.hovered ? Theme.cardHover : Theme.card)
        Behavior on color { ColorAnimation { duration: 90 } }
    }
    Rectangle {
        anchors.fill: parent
        radius: 12
        color: "transparent"
        border.width: 2
        border.color: card.selected ? Theme.selectionBorder : "transparent"
    }

    HoverHandler { id: hover }
    MouseArea {
        anchors.fill: parent
        acceptedButtons: Qt.LeftButton | Qt.MiddleButton | Qt.RightButton
        cursorShape: Qt.PointingHandCursor
        onClicked: (mouse) => {
            if (mouse.button === Qt.LeftButton)
                card.chosen(mouse.modifiers & Qt.ShiftModifier, mouse.modifiers & Qt.ControlModifier)
            else if (mouse.button === Qt.MiddleButton)
                card.pinToggled()
            else
                card.menuRequested(mouse.x, mouse.y)
        }
    }

    ColumnLayout {
        anchors.fill: parent
        anchors.leftMargin: 12
        anchors.rightMargin: 12
        anchors.topMargin: 10 + (card.tagColor !== "" ? 1 : 0)
        anchors.bottomMargin: 12
        spacing: 6

        RowLayout {
            spacing: 6
            Layout.fillWidth: true
            SymbolicIcon {
                name: app.typeIcon(card.type)
                size: 14
                color: card.tagColor !== "" ? card.tagColor : Theme.text70
                Layout.alignment: Qt.AlignVCenter
            }
            RowLayout {
                visible: !titleEditor.visible
                spacing: 6
                Layout.fillWidth: true
                Text {
                    text: card.displayTitle
                    color: card.tagColor !== "" ? card.tagColor : Theme.text85
                    font.pointSize: Theme.pt(0.9)
                    font.bold: true
                    elide: Text.ElideRight
                    Layout.fillWidth: card.customTitle !== ""
                    Layout.maximumWidth: card.customTitle !== "" ? -1 : implicitWidth
                }
                Text {
                    visible: card.customTitle === ""
                    text: app.relativeTime(card.time + 0 * card.now)
                    color: Theme.text50
                    font.pointSize: Theme.pt(0.82)
                    elide: Text.ElideRight
                    Layout.fillWidth: true
                }
            }
            B.TextField {
                id: titleEditor
                visible: false
                Layout.fillWidth: true
                font.pointSize: Theme.pt(0.9)
                color: Theme.text
                selectionColor: Theme.accent
                selectedTextColor: Theme.text
                leftPadding: 8
                rightPadding: 8
                topPadding: 2
                bottomPadding: 2
                background: Rectangle { radius: 6; color: Qt.rgba(0, 0, 0, 0.3) }
                property bool done: true
                function finish(save) {
                    if (done) return
                    done = true
                    visible = false
                    card.titleEditFinished(save, text)
                }
                onAccepted: finish(true)
                onActiveFocusChanged: if (!activeFocus) finish(true)
                Keys.onEscapePressed: finish(false)
            }
            Row {
                spacing: 2
                Layout.alignment: Qt.AlignVCenter
                PillButton {
                    kind: "mini"
                    iconName: "view-more-symbolic"
                    iconSize: 14
                    onClicked: card.menuRequested(-1, -1)
                }
                PillButton {
                    kind: "mini"
                    visible: !card.isProtected
                    iconName: "user-trash-symbolic"
                    iconSize: 14
                    onClicked: card.deleteRequested()
                }
                PillButton {
                    kind: "mini"
                    iconName: "view-pin-symbolic"
                    iconSize: 14
                    checked: card.pinned
                    tint: card.tagColor !== "" ? card.tagColor : "transparent"
                    onClicked: card.pinToggled()
                }
            }
        }

        CardBody {
            type: card.type
            view: card.view
            codeHtml: card.codeHtml
            playing: card.playing
            clip: true
            Layout.fillWidth: true
            Layout.fillHeight: true
        }
    }

    function editTitle() {
        titleEditor.text = card.displayTitle
        titleEditor.done = false
        titleEditor.visible = true
        titleEditor.forceActiveFocus()
        titleEditor.selectAll()
    }
}
