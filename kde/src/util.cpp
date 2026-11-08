#include "util.h"

#include <QCryptographicHash>
#include <QDir>
#include <QFile>
#include <QLocale>
#include <QRegularExpression>
#include <QSaveFile>
#include <QStandardPaths>
#include <QTextBoundaryFinder>
#include <QUrl>

#include <cmath>

namespace Util {

QString dataDir()
{
    return QStandardPaths::writableLocation(QStandardPaths::GenericDataLocation) + QStringLiteral("/copy-addict");
}

QString imageDir()
{
    return dataDir() + QStringLiteral("/images");
}

QString cacheDir()
{
    return QStandardPaths::writableLocation(QStandardPaths::GenericCacheLocation) + QStringLiteral("/copy-addict");
}

QString configDir()
{
    return QStandardPaths::writableLocation(QStandardPaths::GenericConfigLocation) + QStringLiteral("/copy-addict");
}

QString md5(const QByteArray &data)
{
    return QString::fromLatin1(QCryptographicHash::hash(data, QCryptographicHash::Md5).toHex());
}

QString fold(const QString &s)
{
    const QString d = s.normalized(QString::NormalizationForm_D);
    QString out;
    out.reserve(d.size());
    for (const QChar c : d) {
        if (c.category() == QChar::Mark_NonSpacing)
            continue;
        out.append(c);
    }
    return out.toCaseFolded();
}

QString prettyPath(const QString &path)
{
    const QString home = QDir::homePath();
    if (path == home)
        return QStringLiteral("~");
    if (path.startsWith(home + QLatin1Char('/')))
        return QLatin1Char('~') + path.mid(home.size());
    return path;
}

QString uriToPath(const QString &uri)
{
    const QUrl url(uri);
    return url.isLocalFile() ? url.toLocalFile() : QString();
}

QString humanSize(qint64 bytes)
{
    if (bytes < 1024)
        return QStringLiteral("%1 B").arg(bytes);
    static const char *units[] = {"KB", "MB", "GB", "TB"};
    double v = bytes;
    int i = -1;
    do {
        v /= 1024;
        i++;
    } while (v >= 1024 && i < 3);
    return QStringLiteral("%1 %2").arg(QLocale().toString(v, 'f', v < 10 ? 1 : 0), QLatin1String(units[i]));
}

QString normalizeText(const QString &text)
{
    QString t = text;
    t.replace(QLatin1Char('\t'), QStringLiteral("    "));
    t.remove(QLatin1Char('\r'));
    QStringList lines = t.split(QLatin1Char('\n'));
    while (!lines.isEmpty() && lines.first().trimmed().isEmpty())
        lines.removeFirst();
    while (!lines.isEmpty() && lines.last().trimmed().isEmpty())
        lines.removeLast();
    int cut = -1;
    for (const QString &l : std::as_const(lines)) {
        if (l.trimmed().isEmpty())
            continue;
        int n = 0;
        while (n < l.size() && l.at(n) == QLatin1Char(' '))
            n++;
        cut = cut < 0 ? n : std::min(cut, n);
    }
    if (cut > 0) {
        for (QString &l : lines)
            l = l.mid(std::min<qsizetype>(cut, l.size()));
    }
    return lines.join(QLatin1Char('\n'));
}

QString escapeHtml(const QString &s)
{
    return s.toHtmlEscaped();
}

int graphemeCount(const QString &s)
{
    QTextBoundaryFinder f(QTextBoundaryFinder::Grapheme, s);
    int n = 0;
    while (f.toNextBoundary() != -1)
        n++;
    return n;
}

bool isLink(const QString &t)
{
    static const QRegularExpression scheme(QStringLiteral("^https?://"), QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression space(QStringLiteral("\\s"));
    if (!scheme.match(t).hasMatch() || space.match(t).hasMatch())
        return false;
    const QUrl url(t, QUrl::StrictMode);
    return url.isValid() && !url.host().isEmpty();
}

static const QStringList &namedColors()
{
    static const QStringList names = QStringLiteral(
        "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown "
        "burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod "
        "darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen "
        "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue "
        "firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew "
        "hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan "
        "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray "
        "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid "
        "mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream "
        "mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen "
        "paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown "
        "royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow "
        "springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen")
        .split(QLatin1Char(' '));
    return names;
}

static const QString NUM = QStringLiteral("[-+]?(?:\\d+\\.?\\d*|\\.\\d+)");

bool isColor(const QString &t)
{
    static const QRegularExpression hex(QStringLiteral("^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$"), QRegularExpression::CaseInsensitiveOption);
    static const QRegularExpression func(
        QStringLiteral("^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\\(\\s*[a-z-]*\\s*%1(?:%|deg|turn|rad)?(?:\\s*[,\\s/]\\s*%1(?:%|deg|turn|rad)?){2,3}\\s*\\)$").arg(NUM),
        QRegularExpression::CaseInsensitiveOption);
    if (hex.match(t).hasMatch() || func.match(t).hasMatch())
        return true;
    return namedColors().contains(t.toLower());
}

// A number or percentage scaled to 0..max.
static double component(const QString &s, double max)
{
    if (s.endsWith(QLatin1Char('%')))
        return std::clamp(s.chopped(1).toDouble() / 100.0 * max, 0.0, max);
    return std::clamp(s.toDouble(), 0.0, max);
}

static double hue(const QString &s)
{
    double v = s.toDouble();
    if (s.endsWith(QLatin1String("turn")))
        v = s.chopped(4).toDouble() * 360;
    else if (s.endsWith(QLatin1String("rad")))
        v = s.chopped(3).toDouble() * 180 / M_PI;
    else if (s.endsWith(QLatin1String("deg")))
        v = s.chopped(3).toDouble();
    v = std::fmod(v, 360.0);
    return v < 0 ? v + 360 : v;
}

QColor parseCssColor(const QString &text)
{
    const QString t = text.trimmed().toLower();
    if (t.startsWith(QLatin1Char('#'))) {
        QString h = t.mid(1);
        if (h.size() == 3 || h.size() == 4) {
            QString full;
            for (QChar c : h)
                full += QString(2, c);
            h = full;
        }
        bool ok = false;
        if (h.size() == 6) {
            uint v = h.toUInt(&ok, 16);
            return ok ? QColor((v >> 16) & 255, (v >> 8) & 255, v & 255) : QColor();
        }
        if (h.size() == 8) {   // CSS order is RRGGBBAA
            uint v = h.toUInt(&ok, 16);
            return ok ? QColor((v >> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255) : QColor();
        }
        return QColor();
    }
    static const QRegularExpression fn(QStringLiteral("^(rgba?|hsla?)\\((.*)\\)$"));
    const auto m = fn.match(t);
    if (m.hasMatch()) {
        QString args = m.captured(2);
        args.replace(QLatin1Char(','), QLatin1Char(' ')).replace(QLatin1Char('/'), QLatin1Char(' '));
        const QStringList p = args.split(QLatin1Char(' '), Qt::SkipEmptyParts);
        if (p.size() < 3 || p.size() > 4)
            return QColor();
        const double a = p.size() == 4 ? component(p[3], 1.0) : 1.0;
        if (m.captured(1).startsWith(QLatin1String("rgb"))) {
            return QColor::fromRgbF(component(p[0], 255) / 255, component(p[1], 255) / 255, component(p[2], 255) / 255, a);
        }
        const double s = component(p[1], 1.0), l = component(p[2], 1.0);
        return QColor::fromHslF(hue(p[0]) / 360.0, s, l, a);
    }
    if (namedColors().contains(t))
        return QColor::fromString(t);
    return QColor();
}

QString hexOf(const QColor &c)
{
    QString s = QStringLiteral("#%1%2%3").arg(c.red(), 2, 16, QLatin1Char('0')).arg(c.green(), 2, 16, QLatin1Char('0')).arg(c.blue(), 2, 16, QLatin1Char('0'));
    if (c.alpha() < 255)
        s += QStringLiteral("%1").arg(c.alpha(), 2, 16, QLatin1Char('0'));
    return s;
}

static QString alphaText(const QColor &c)
{
    return QString::number(std::round(c.alphaF() * 1000) / 1000, 'g', 4);
}

QString rgbOf(const QColor &c)
{
    if (c.alpha() < 255)
        return QStringLiteral("rgba(%1, %2, %3, %4)").arg(c.red()).arg(c.green()).arg(c.blue()).arg(alphaText(c));
    return QStringLiteral("rgb(%1, %2, %3)").arg(c.red()).arg(c.green()).arg(c.blue());
}

QString hslOf(const QColor &c)
{
    const double r = c.redF(), g = c.greenF(), b = c.blueF();
    const double mx = std::max({r, g, b}), mn = std::min({r, g, b});
    double h = 0, s = 0;
    const double l = (mx + mn) / 2;
    if (mx != mn) {
        const double d = mx - mn;
        s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        if (mx == r)
            h = (g - b) / d + (g < b ? 6 : 0);
        else if (mx == g)
            h = (b - r) / d + 2;
        else
            h = (r - g) / d + 4;
        h *= 60;
    }
    const QString base = QStringLiteral("%1, %2%, %3%").arg(std::lround(h)).arg(std::lround(s * 100)).arg(std::lround(l * 100));
    if (c.alpha() < 255)
        return QStringLiteral("hsla(%1, %2)").arg(base, alphaText(c));
    return QStringLiteral("hsl(%1)").arg(base);
}

bool writePrivateFile(const QString &path, const QByteArray &data)
{
    QSaveFile f(path);
    if (!f.open(QIODevice::WriteOnly))
        return false;
    f.setPermissions(QFileDevice::ReadOwner | QFileDevice::WriteOwner);
    f.write(data);
    return f.commit();
}

}
