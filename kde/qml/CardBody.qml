// The preview part of a card, by item type.
import QtQuick
import QtQuick.Layouts

Item {
    id: body
    property string type
    property var view: ({})
    property string codeHtml
    property bool playing: true
    readonly property bool crop: settings.imageFit !== "contain"

    Loader {
        anchors.fill: parent
        sourceComponent: {
            switch (body.type) {
            case "image": return imageBody
            case "code": return codeBody
            case "link": return linkBody
            case "file": return fileBody
            case "files": return filesBody
            case "color": return colorBody
            case "character": return charBody
            default: return textBody
            }
        }
    }

    component Info: Text {
        color: Theme.text50
        font.pointSize: Theme.pt(0.78)
        elide: Text.ElideRight
        Layout.fillWidth: true
    }

    component Missing: ColumnLayout {
        property string label
        property string icon
        spacing: 6
        Item { Layout.fillHeight: true }
        SymbolicIcon { name: parent.icon; size: 32; color: Theme.text45; Layout.alignment: Qt.AlignHCenter }
        Text { text: parent.label; color: Theme.text50; font.pointSize: Theme.pt(0.85); Layout.alignment: Qt.AlignHCenter }
        Item { Layout.fillHeight: true }
    }

    component Code: Item {
        property string html
        clip: true
        Text {
            width: parent.width
            textFormat: Text.RichText
            text: parent.html
            color: "#f6f5f4"
            font.family: Theme.mono
            font.pointSize: Theme.pt(0.82)
            wrapMode: Text.WrapAtWordBoundaryOrAnywhere
        }
    }

    Component {
        id: textBody
        Text {
            text: body.view.text || ""
            textFormat: Text.PlainText
            color: Theme.text92
            font.pointSize: Theme.pt(0.92)
            wrapMode: Text.WrapAtWordBoundaryOrAnywhere
            elide: Text.ElideRight
            verticalAlignment: Text.AlignTop
        }
    }

    Component {
        id: codeBody
        Code { html: body.codeHtml }
    }

    Component {
        id: imageBody
        ColumnLayout {
            spacing: 4
            Missing {
                visible: !body.view.exists
                label: i18n("Missing image")
                icon: "image-missing-symbolic"
                Layout.fillWidth: true
                Layout.fillHeight: true
            }
            RoundedImage {
                visible: !!body.view.exists
                source: body.view.source || ""
                animated: !!body.view.animated
                playing: body.playing
                crop: body.crop
                Layout.fillWidth: true
                Layout.fillHeight: true
            }
            Info { visible: !!body.view.info; text: body.view.info || "" }
        }
    }

    Component {
        id: linkBody
        ColumnLayout {
            spacing: 4
            RoundedImage {
                visible: !!body.view.image
                source: body.view.image || ""
                crop: false
                Layout.fillWidth: true
                Layout.fillHeight: true
                Layout.minimumHeight: 64
            }
            Text {
                visible: !!body.view.loaded
                text: body.view.title || i18n("No title")
                color: Theme.text
                font.pointSize: Theme.pt(0.9)
                font.bold: true
                wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                elide: Text.ElideRight
                maximumLineCount: body.view.image ? 2 : 3
                Layout.fillWidth: true
            }
            Text {
                visible: !!body.view.loaded && !!body.view.description
                text: body.view.description || ""
                color: Theme.text65
                font.pointSize: Theme.pt(0.8)
                wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                elide: Text.ElideRight
                maximumLineCount: body.view.image ? 2 : 4
                Layout.fillWidth: true
            }
            Text {
                visible: !body.view.loaded
                text: i18n("Loading preview…")
                color: Theme.text50
                font.pointSize: Theme.pt(0.85)
            }
            Item { Layout.fillHeight: !body.view.image; Layout.fillWidth: true }
            Text {
                text: body.view.url || ""
                color: Theme.link
                font.pointSize: Theme.pt(0.78)
                elide: Text.ElideMiddle
                Layout.fillWidth: true
            }
        }
    }

    Component {
        id: fileBody
        ColumnLayout {
            spacing: 4
            readonly property string preview: body.view.preview || "missing"
            Text {
                visible: preview === "missing"
                text: body.view.path || ""
                color: Theme.text60
                font.pointSize: Theme.pt(0.82)
                elide: Text.ElideLeft
                Layout.fillWidth: true
            }
            Missing {
                visible: preview === "missing"
                label: i18n("Missing file")
                icon: "dialog-question-symbolic"
                Layout.fillWidth: true
                Layout.fillHeight: true
            }
            RoundedImage {
                visible: preview === "image" || preview === "thumb"
                source: preview === "image" || preview === "thumb" ? body.view.image : ""
                animated: preview === "image" && !!body.view.animated
                playing: body.playing
                crop: preview === "image" && body.crop
                Layout.fillWidth: true
                Layout.fillHeight: true
            }
            Code {
                visible: preview === "code"
                html: preview === "code" ? body.codeHtml : ""
                Layout.fillWidth: true
                Layout.fillHeight: true
            }
            Item {
                visible: preview === "icon"
                Layout.fillWidth: true
                Layout.fillHeight: true
                SymbolicIcon {
                    anchors.centerIn: parent
                    name: preview === "icon" ? (body.view.icon + "|" + body.view.fallbackIcon + "|text-x-generic") : ""
                    recolor: false
                    size: 56
                }
            }
            Text {
                visible: preview !== "missing"
                text: body.view.name || ""
                color: Theme.text
                font.pointSize: Theme.pt(0.88)
                font.bold: true
                elide: Text.ElideMiddle
                Layout.fillWidth: true
            }
            Info { visible: preview !== "missing"; text: body.view.detail || ""; elide: Text.ElideLeft }
        }
    }

    Component {
        id: filesBody
        ColumnLayout {
            spacing: 4
            Text {
                text: body.view.base || ""
                color: Theme.text60
                font.pointSize: Theme.pt(0.82)
                elide: Text.ElideLeft
                Layout.fillWidth: true
            }
            ColumnLayout {
                spacing: 3
                Layout.fillWidth: true
                Repeater {
                    model: body.view.rows || []
                    RowLayout {
                        required property var modelData
                        spacing: 6
                        Layout.fillWidth: true
                        SymbolicIcon { name: modelData.isDir ? "folder-symbolic" : "text-x-generic-symbolic"; size: 14; color: Theme.text85 }
                        Text {
                            text: modelData.name
                            color: Theme.text92
                            font.pointSize: Theme.pt(0.86)
                            elide: Text.ElideMiddle
                            Layout.fillWidth: true
                        }
                    }
                }
            }
            Item { Layout.fillHeight: true }
            Info {
                visible: (body.view.more || 0) > 0
                text: i18np("+%1 file", "+%1 files", body.view.more || 0)
            }
        }
    }

    Component {
        id: colorBody
        Rectangle {
            radius: 8
            color: body.view.valid ? body.view.color : Qt.rgba(1, 1, 1, 0.06)
            border.width: body.view.valid ? 0 : 1
            border.color: Qt.rgba(1, 1, 1, 0.25)
            Text {
                anchors.centerIn: parent
                width: parent.width - 16
                horizontalAlignment: Text.AlignHCenter
                text: body.view.text || ""
                elide: Text.ElideRight
                color: body.view.dark ? Qt.rgba(0, 0, 0, 0.8) : Qt.rgba(1, 1, 1, 0.85)
                font.family: Theme.mono
                font.bold: true
                font.pointSize: Theme.pt(1.05)
            }
        }
    }

    Component {
        id: charBody
        ColumnLayout {
            spacing: 4
            Text {
                text: body.view.char || ""
                color: Theme.text
                font.pixelSize: 56
                horizontalAlignment: Text.AlignHCenter
                verticalAlignment: Text.AlignVCenter
                Layout.fillWidth: true
                Layout.fillHeight: true
            }
            Info { text: body.view.codes || ""; horizontalAlignment: Text.AlignHCenter }
        }
    }
}
