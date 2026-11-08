// Small helpers shared by the store, capture and UI code.
#pragma once

#include <QColor>
#include <QString>
#include <QStringList>

namespace Util {

QString dataDir();     // ~/.local/share/copy-addict
QString imageDir();    // ~/.local/share/copy-addict/images
QString cacheDir();    // ~/.cache/copy-addict
QString configDir();   // ~/.config/copy-addict

QString md5(const QByteArray &data);
QString fold(const QString &s);                // lower case, no accents (for search)
QString prettyPath(const QString &path);       // /home/me/x -> ~/x
QString uriToPath(const QString &uri);         // file:///a%20b -> /a b ("" if not a local file)
QString humanSize(qint64 bytes);
QString normalizeText(const QString &text);    // trim blank edges, tabs to spaces, strip shared indent
QString escapeHtml(const QString &s);
int graphemeCount(const QString &s);
bool isLink(const QString &t);
bool isColor(const QString &t);

// CSS colour parsing (hex, rgb(a), hsl(a), named). Returns an invalid QColor if unknown.
QColor parseCssColor(const QString &text);
QString hexOf(const QColor &c);
QString rgbOf(const QColor &c);
QString hslOf(const QColor &c);

bool writePrivateFile(const QString &path, const QByteArray &data);   // atomic, mode 0600

}
