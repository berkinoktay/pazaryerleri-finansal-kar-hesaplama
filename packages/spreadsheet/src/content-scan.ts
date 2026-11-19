import { isUtf8 } from 'node:buffer';

import { strFromU8 } from 'fflate';
import { MAX_FORMULA_SCAN_UNITS, MAX_XMLNS_DECLARATIONS_PER_PART } from './constants';
import { SpreadsheetFileError } from './errors';
import {
  formulaReadings,
  formulaReadingsRefusal,
  type FormulaReadings,
  type QuotedSection,
} from './formula-scan';
import { packagePartError } from './patch/calc-chain';
import {
  UNSAFE_CONTENT_DETAILS,
  UNSAFE_CONTENT_REASONS,
  UPLOAD_LIMIT_REASONS,
  ZIP_REJECT_REASONS,
  type UnsafeContentDetail,
} from './patch/reasons';
import { bytesEqualAt, foldAsciiCase, metaEntryName, unsafeContentError } from './patch/shared';
import {
  ATTRIBUTE_NAME_END,
  ATTRIBUTE_NAME_START,
  ATTRIBUTE_VALUE_END,
  ATTRIBUTE_VALUE_START,
  attributeField,
  bytesEqualAscii,
  createMarkup,
  declaresUtf8,
  hasDeclarationTarget,
  isNameByte,
  isXmlDeclaration,
  isXmlSpace,
  localNameStart,
  NAME_DECODER,
  NAMESPACE_DECLARATION,
  NAMESPACE_DECLARATION_PREFIX,
  nextMarkup,
  QUESTION,
  scanMarkup,
  SPACE,
  TAG_OPEN,
  XmlLexError,
  type XmlMarkup,
} from './patch/xml-lexer';
import {
  createUrlStartReader,
  isAbsoluteUrl,
  readUrlStart,
  type UrlStartReader,
} from './url-target';

// The entries the grid reader may open: exactly the names ending in `.xml` or
// `.xml.rels` (the rule read-excel-file's filterZipArchiveEntry used, kept so the same
// parts are read). The gate scans more than these (see "Which entries are XML").
const XML_PART_SUFFIXES: readonly string[] = ['.xml', '.xml.rels'];

// A DOCTYPE or ENTITY declaration can define entities that expand exponentially
// (billion laughs) or resolve external resources (XXE). A genuine xlsx part never
// carries a DTD.
const DTD_DECLARATION = /<!(?:DOCTYPE|ENTITY)/i;

// An `&` that does not start one of the five predefined references or a numeric
// character reference. Linear: the lookahead only runs at `&` positions and its digit
// runs stop at the next non-digit, so no `[\s\S]*?` span is ever re-scanned.
// A bare `&` inside a CDATA section is rejected too, on purpose: Excel never writes
// CDATA, so this only fails closed on hand-made files.
const UNKNOWN_ENTITY_REFERENCE = /&(?!(?:amp|lt|gt|quot|apos);|#\d+;|#x[0-9a-fA-F]+;)/;

// Which entries are XML. The byte-preserving export hands every entry of a stored upload
// on unchanged, and an opener finds a part by its relationship, not by its name, so the
// gate chooses the parts it scans by their content: an entry is XML when, after an
// optional UTF-8 byte order mark, its first byte that is not XML white space is '<'.
// An entry that starts with a UTF-16 or UTF-32 byte order mark or with `<?xm` in EBCDIC
// (the signature by which an XML reader detects an EBCDIC declaration), or whose first
// '<' has a U+0000 byte right before or after it (UTF-16 or UTF-32 text without a
// mark), is XML the scans cannot read: CORRUPT_FILE `part-encoding`. So is an entry named `.xml`,
// `.rels` or `.vml` (ASCII case folded) whose content is not XML. The decision reads the
// first bytes only, chunk by chunk (EntryContentSniff), so the stream keeps nothing of
// an image or another binary entry.
const XML_CONTENT_NAME_SUFFIXES: readonly string[] = ['.xml', '.rels', '.vml'];
const UTF8_BYTE_ORDER_MARK: readonly number[] = [0xef, 0xbb, 0xbf];
// UTF-16 big and little endian (the little-endian one also opens UTF-32 little endian),
// and UTF-32 big endian.
const OTHER_BYTE_ORDER_MARKS: readonly (readonly number[])[] = [
  [0xfe, 0xff],
  [0xff, 0xfe],
  [0x00, 0x00, 0xfe, 0xff],
];
// `<?xm` in EBCDIC: the first bytes of an XML declaration written in it.
const EBCDIC_DECLARATION_START: readonly number[] = [0x4c, 0x6f, 0xa7, 0x94];
// The first bytes held until the byte order mark is read: the longest mark.
const BYTE_ORDER_MARK_LENGTH = 4;
const NO_BYTE = -1;

// Formula fields (spec section 2.1 item 7). In every XML part, whatever its root element
// and path, the gate reads every field Excel evaluates: the text of the
// FORMULA_ELEMENT_NAMES elements, the value of the FORMULA_ATTRIBUTE_NAMES attributes,
// and the value of the ELEMENT_FORMULA_ATTRIBUTE_NAMES attributes on their one element
// (a conditional format value object's `val`, a hyperlink's `location`, a camera tool's
// `cellRange`), local names compared ignoring their prefix and ASCII case (so a reader
// that ignores case finds no field the gate skipped). A hyperlink's `location` is no
// field only when the hyperlink leads to an external hyperlink of its part: it has a
// relationship id (an `id` attribute whose prefix is bound to RELATIONSHIPS_NAMESPACE
// where it stands), and every one it has names a relationship of the part's own
// relationships part whose type ends in `hyperlink` and whose TargetMode is `External`
// (ExternalHyperlinkIds, read by unsafe-parts.ts by the worksheet source rule). Then the
// hyperlink leads to the relationship's URL and Excel keeps that URL's #fragment in
// `location` (https://site/page#part: Target https://site/page, location `part`), which
// is no formula. No other element may name an external hyperlink of its part: an
// element whose local name is not `hyperlink` with a prefixed attribute whose local
// name is `id` (ASCII case ignored, whatever namespace its prefix is bound to) and whose
// decoded value names a relationship of the part's relationships part that is an
// external hyperlink (a worksheet `<picture r:id>` would load its background from the
// web) is refused, UNSAFE_CONTENT `unsafe-part`. Both rules compare a relationship id
// read the way an XML processor reads an attribute value (XML 1.0 sections 2.11 and
// 3.3.3, attributeValueText): each literal CR LF pair, CR, LF and TAB is one space, a
// referenced one stays itself. Each field is decoded (the five
// predefined references and every character reference replaced) and must pass
// formula-scan.ts; in the `formula` attribute of a PIVOT_FORMULA_ELEMENT_NAMES element
// (a pivot calculated field or item) a quoted section is a field name, not a sheet name.
// What the formula scan reads of one upload is bounded (FormulaScanBudget): the code
// units of every field it scans, raw plus its NFKC form when that differs, in every part
// together, at most MAX_FORMULA_SCAN_UNITS, beyond which the upload is PAYLOAD_TOO_LARGE
// `formula-scan-budget`.
// An element field must hold text only, up to its own end tag: a comment, CDATA section,
// processing instruction or child element could split a name or hide it from a text
// scan. The one exception is the shape Excel 2010+ writes for a data validation list or
// a conditional format that reaches another sheet (`<x14:formula1><xm:f>Lists!$A$2:$A$20
// </xm:f></x14:formula1>`): exactly one child element whose local name is `f`, holding
// text only, with nothing but white space around it; that inner text is the field. An
// empty field passes.
// An Office Math fraction is also named `f` (an equation in a text box writes
// `<m:f><m:fPr/>...</m:f>`), so an element in the OMML_NAMESPACE is not a formula field.
// The walk keeps the namespace declarations in scope (NamespaceScopes): a prefix is held
// only while a declaration of it is in scope, and its key is dropped with its last
// binding, so the prefixes held at once never outnumber the declarations in scope, which
// MAX_XMLNS_DECLARATIONS_PER_PART caps. It keeps the qualified name of every open
// element (two offsets into the
// part) up to MAX_TRACKED_ELEMENT_DEPTH open elements, and every end tag must name the
// innermost open element, byte for byte. An end tag that names another element (a
// lenient reader may close an ancestor there), an end tag with no element open, or an
// element opened past that depth leaves the walk unable to follow the nesting: from
// there on to the end of the part no binding counts, so every `f` is a field, every
// hyperlink `location` a formula and no attribute an Excel data attribute (see "CSS").
// A part that has more than MAX_XMLNS_DECLARATIONS_PER_PART declarations in scope at
// once (those of the open
// elements and of the element being read; once the walk cannot follow the nesting,
// every declaration read from there on stays counted) is refused with the error the
// reader parts get for more declarations in all (tooManyNamespaceDeclarations); the
// reader parts keep that cap on every declaration they hold (guards.ts).
// A macro assignment needs code the gate never accepts, so a non-empty
// MACRO_ATTRIBUTE_NAMES attribute or FmlaMacro element is refused (Excel writes
// `macro=""` on every shape), and an element of ACTIVE_ELEMENT_NAMES (an embedded
// object, a control, a web publishing item; SVG and HTML `script`, `foreignObject`,
// `iframe`, `object` and `embed`; an XML Events `handler` or `listener`) is refused
// wherever it stands. So is a
// SCRIPT_ELEMENT_NAMES element (a VML control's script) that holds anything but white
// space.
// Event handlers. An attribute whose ASCII-folded local name starts with
// EVENT_HANDLER_PREFIX `on` (a namespace declaration aside) runs script in an SVG or
// HTML renderer, so it is refused on an element in an EVENT_HANDLER_NAMESPACES namespace
// (SVG, XHTML, XML Events) by the bindings in scope (a declaration read decoded, one the
// scan cannot decode taken for one of them), on every element of a part one of whose
// top-level elements has the local name SVG_ROOT_NAME `svg` (ASCII case ignored), on
// every element once the walk cannot follow the nesting, and on the one child element
// of a formula field (whose own declarations the walk does not follow). Elsewhere VML's
// `on` attribute (`<v:shadow on="t">`) passes.
// Web content. In the same scope, an SVG_ANIMATION_ELEMENT_NAMES element (`set`,
// `animate`, `animateMotion`, `animateTransform`, `animateColor`: SMIL animation can point
// an href at any URL; local names compared ignoring ASCII case) is refused, and so is an
// attribute whose ASCII-folded local name, any prefix, is one of
// WEB_RESOURCE_ATTRIBUTE_NAMES (`data`, `srcset`, `poster`, `action`, `ping` and the like:
// a web renderer loads or sends to what it names), whatever its value. Elsewhere an OOXML
// `set` (a pivot cache's OLAP set) and a `data` attribute (VML's `<o:idmap data="1">`)
// pass.
// URLs. A URL attribute (`src`, or any local name that ends with URL_ATTRIBUTE_SUFFIX
// `href`, ASCII case ignored, any prefix: VML's v:imagedata@src, @o:href, @o:althref,
// v:fill@src, a shape's href, SVG's xlink:href)
// or a BASE_URL_ATTRIBUTE_NAMES attribute (`base`: xml:base) names a resource outside
// the relationships, so its decoded value must be relative by the rule of url-target.ts
// (no URI scheme, drive letter, leading '//' or backslash). The one exception is a URL
// attribute of an IMAGE_ELEMENT_NAMES element (`image`, `imagedata`, local names
// compared exactly) whose value is a `data:` URI of a DATA_IMAGE_MEDIA_TYPES raster
// image (DATA_URL_SCHEME and the media type up to its ';' or ',', ASCII case ignored):
// an image the value holds, which fetches nothing and runs no script. Any other `data:`,
// an SVG image's (`image/svg+xml`) included, is refused.
// CSS. A style (the value of a STYLE_NAMES attribute, and the text and CDATA content of
// a STYLE_NAMES element up to its own end tag, or to the end of the part when the walk
// cannot follow the nesting there, its descendants' included but for the formula, macro
// and script fields scanned on their own) and any other attribute value, whatever its
// name (CSS to an SVG renderer: `fill`, `filter`, `clip-path`, `mask`, `cursor`,
// `marker-*`), but for an Excel data attribute (below), must load nothing; the rule over
// those other attribute values is the broad rule. Neither may hold a `url(` whose
// target, past CSS white space, an optional quote and CSS white space again, does not
// start with '#': only a fragment of the document (`url(#grad1)`) passes, a relative,
// absolute, `data:` or empty target (or a CSS text that ends inside the target) loads;
// nor a call of a CSS_LOADING_FUNCTIONS function (`image-set`, `image`, `src`,
// `cross-fade`), wherever it stands. A call is read the way a CSS tokenizer reads a
// function name (CssNameRun):
// the run of identifier code points (ASCII letters, digits, '-', '_', any non-ASCII code
// point, and escapes) right before a '(' is decoded (a backslash and one to
// MAX_CSS_HEX_DIGITS hexadecimal digits, then one optional CSS white space, stand for
// that code point; a backslash and any other code point but a newline for that code
// point; a backslash and a newline, no escape to CSS, is taken for nothing inside the
// run, which fails closed), and a run whose decoded text, ASCII case ignored, ends with
// `url` opens a `url(` target and one that ends with a CSS_LOADING_FUNCTIONS name calls
// it (`\75rl(`, `u\72l(`, `image\2dset(`, `-webkit-image-set(` and `xurl(` all count).
// A style may also hold no `@import`, no backslash (a CSS escape can spell any name) and
// no quoted string whose content starts a URL that is absolute by the rule of
// url-target.ts (read past every quote, so a quote inside a comment cannot hide the
// string that follows). Any other attribute value the broad rule reads may hold no
// backslash from its first `url(` on; a backslash that spells no call (a VML title
// `C:\logo`) passes. The text of a style element is read piece by piece (CssScan), in
// constant memory: nothing of it is kept but the end of the identifier run its last code
// units spell, how much of `@import` they spell, where the last `url(` target stands and
// how the text past its last quote starts. A STYLESHEET_INSTRUCTION_NAMES processing
// instruction (`xml-stylesheet`) is refused wherever it stands.
// Excel data attributes. The broad rule would refuse clean Excel data that only reads
// like a call, a word ending in `url`, `src` or `image` glued to '(' (an autofilter value
// `Curl(25mm)`, a validation prompt `image(s)`, a picture description
// `C:\x\image(1).png`, a pivot item, a table column or sheet name, the folder a workbook
// was saved in), and no renderer reads CSS there. So the broad rule skips an unprefixed
// attribute (OOXML data attributes are unqualified) of an element whose namespace, by
// the bindings in scope, is one of OFFICE_DATA_NAMESPACES (SpreadsheetML, spreadsheet
// drawing, DrawingML and chart, each transitional and strict, and the Microsoft
// SpreadsheetML extension namespaces), its declaration matched byte for byte (one
// written with a reference names another namespace; one the scan cannot decode is taken
// for an EVENT_HANDLER_NAMESPACES one), when the element stands outside a style element
// and before the part's first web content. Web content starts at the first element in
// an EVENT_HANDLER_NAMESPACES namespace or whose local name is SVG_ROOT_NAME `svg`
// (ASCII case ignored) at any depth and in any namespace (so every element of an svg
// part), that element included, at the first element read once the walk cannot follow
// the nesting, or at a comment, CDATA section or processing instruction that holds
// SVG_TAG_OPEN `<svg` (ASCII case ignored), which an HTML reader, ending it at its first
// '>', may read as an `svg` start tag; no element from there to the end of the part is
// exempt. The broad
// rule still reads every other attribute value: a prefixed attribute (`s:fill`), and any
// attribute of an element in another namespace (SVG, XHTML, XML Events, VML, Office
// VML), of one with no namespace or an unknown one, of one inside a style element
// (whatever its namespace) and of the one child element of a formula field (whose own
// declarations the walk does not follow, so that child starts no web content either:
// there the scan trusts a namespace-aware reading, as the event-handler rule does, and
// an element read after it may still be exempt). A skipped value still passes every other check
// its name calls for (a macro is empty, a URL or base relative, a formula field safe),
// and one that holds a reference the scan cannot decode is still CORRUPT_FILE
// `package-part` (below). Every style is checked as before, and so is the loose path
// past markup the strict lexer refuses, which never looks at namespaces (below).
// Each refusal is UNSAFE_CONTENT `unsafe-part`; its detail tells a style that loads
// (`css-load`) from any other attribute value the broad rule reads that does
// (`css-load-attribute`).
// An attribute value that holds a reference the scan cannot decode (a character
// reference past U+10FFFF) is CORRUPT_FILE `package-part`, the error the relationships
// walk gives a Target it cannot decode.
// Where the strict lexer refuses markup that a lenient or a non-ASCII reading accepts,
// the walk cannot tell where the fields are, or which elements a web renderer reads,
// from there on, so the part is refused when anything after that point could open a
// field, macro, script, active or SVG animation element or an element with a field
// attribute of its own, or name a field, macro, URL, base, style or web resource
// attribute, an event handler (any name that starts with `on`), a style element or a
// stylesheet instruction, or when it holds a call of `url(` or a CSS_LOADING_FUNCTIONS
// function (its bytes read by CssNameRun, escapes decoded) or a character reference
// (which could spell one), or, in a part with external hyperlinks, a prefixed `id`
// name; inside a style element the part is refused at once. This path never looks at
// namespaces, so no Excel data attribute is exempt on it.
// Every pass is linear in the part; the formula fields are read without a regular
// expression (formula-scan.ts).
const FORMULA_ELEMENT_NAMES: readonly string[] = [
  'f',
  'formula',
  'formula1',
  'formula2',
  'oldFormula',
  'calculatedColumnFormula',
  'totalsRowFormula',
  'definedName',
  'FmlaLink',
  'FmlaRange',
  'FmlaTxbx',
  'FmlaPict',
  'FmlaGroup',
];
const FORMULA_ATTRIBUTE_NAMES: readonly string[] = [
  'formula',
  'textlink',
  'link',
  'fmlaLink',
  'fmlaRange',
  'fmlaTxbx',
  'fmlaGroup',
  'fmlaPict',
];
// Attributes that are formula fields on one element only: [element, attribute].
const ELEMENT_FORMULA_ATTRIBUTE_NAMES: readonly (readonly [element: string, attribute: string])[] =
  [
    ['cfvo', 'val'],
    ['hyperlink', 'location'],
    ['cameraTool', 'cellRange'],
  ];
// Elements whose `formula` attribute names pivot fields in its quoted sections.
const PIVOT_FORMULA_ELEMENT_NAMES: readonly string[] = ['cacheField', 'calculatedItem'];
const PIVOT_FORMULA_ATTRIBUTE_NAME = 'formula';
// The local name of the one child element a formula field may hold (see the header).
const INNER_FORMULA_ELEMENT_NAME = 'f';
// Elements whose field attribute is a URL fragment when they carry a relationship id.
const URL_FRAGMENT_ELEMENT_NAMES: readonly string[] = ['hyperlink'];
// The local name of a relationship id attribute (`r:id`), compared exactly.
const RELATIONSHIP_ID_ATTRIBUTE = 'id';
const MACRO_ATTRIBUTE_NAMES: readonly string[] = ['macro', 'fmlaMacro'];
const MACRO_ELEMENT_NAMES: readonly string[] = ['FmlaMacro'];
const SCRIPT_ELEMENT_NAMES: readonly string[] = ['ScriptText'];
const URL_ATTRIBUTE_NAMES: readonly string[] = ['src'];
// Every attribute whose ASCII-folded local name ends with this is a URL attribute too.
const URL_ATTRIBUTE_SUFFIX = 'href';
const BASE_URL_ATTRIBUTE_NAMES: readonly string[] = ['base'];
// The one data: URIs a URL attribute may hold, on an IMAGE_ELEMENT_NAMES element only
// (see the header): the scheme, then one of these media types up to the first of
// DATA_MEDIA_TYPE_ENDS, compared ASCII-folded.
const DATA_URL_SCHEME = 'data:';
const DATA_IMAGE_MEDIA_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/bmp',
];
const DATA_MEDIA_TYPE_ENDS: readonly string[] = [';', ','];
const IMAGE_ELEMENT_NAMES: readonly string[] = ['image', 'imagedata'];
// Attributes and elements whose value or text is CSS.
const STYLE_NAMES: readonly string[] = ['style'];
// Processing instruction targets that load a resource.
const STYLESHEET_INSTRUCTION_NAMES: readonly string[] = ['xml-stylesheet'];
const ACTIVE_ELEMENT_NAMES: readonly string[] = [
  'oleObject',
  'oleObjects',
  'control',
  'controls',
  'webPublishItem',
  'webPublishObject',
  'script',
  'foreignObject',
  'iframe',
  'object',
  'embed',
  'handler',
  'listener',
];
// An attribute whose ASCII-folded local name starts with this is an event handler (see
// the header).
const EVENT_HANDLER_PREFIX = 'on';
// The namespaces a web renderer reads (event handlers and web content, see the header):
// SVG, XHTML, XML Events.
const EVENT_HANDLER_NAMESPACES: readonly string[] = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/2001/xml-events',
];
// The local name of a top-level element that makes every element of its part web content.
const SVG_ROOT_NAME = 'svg';
// What an HTML reader, which ends a comment, CDATA section or processing instruction at
// its first '>', may read past that as an `svg` start tag (ASCII case ignored).
const SVG_TAG_OPEN = `<${SVG_ROOT_NAME}`;
// SVG animation elements (see the header).
const SVG_ANIMATION_ELEMENT_NAMES: readonly string[] = [
  'set',
  'animate',
  'animateMotion',
  'animateTransform',
  'animateColor',
];
// Attributes that name a resource a web renderer loads or sends to (see the header).
const WEB_RESOURCE_ATTRIBUTE_NAMES: readonly string[] = [
  'data',
  'srcset',
  'poster',
  'background',
  'action',
  'formaction',
  'codebase',
  'archive',
  'longdesc',
  'usemap',
  'cite',
  'profile',
  'manifest',
  'ping',
];
// Office Math Markup Language: its elements are never formula fields (see the header).
const OMML_NAMESPACE = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
// The namespace of a relationship id (see the header).
const RELATIONSHIPS_NAMESPACE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
// The Office data namespaces (OFFICE_DATA_NAMESPACES): an unprefixed attribute of an
// element in one of them, read before the part's first web content and outside a style
// element, is Excel data that no renderer reads as CSS, so the broad CSS rule skips it
// (see the header). Each is matched byte for byte.
// SpreadsheetML (`x` or the default namespace): autofilter values, validation prompts
// and errors, pivot items, table column and sheet names.
const SPREADSHEETML_NAMESPACE = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
// SpreadsheetML in the strict form (ECMA-376 Part 1 Strict): the same seller text.
const STRICT_SPREADSHEETML_NAMESPACE = 'http://purl.oclc.org/ooxml/spreadsheetml/main';
// SpreadsheetML drawing (`xdr`): picture and shape names, titles and descriptions.
const SPREADSHEET_DRAWING_NAMESPACE =
  'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
// SpreadsheetML drawing in the strict form: the same seller text.
const STRICT_SPREADSHEET_DRAWING_NAMESPACE =
  'http://purl.oclc.org/ooxml/drawingml/spreadsheetDrawing';
// DrawingML (`a`): hyperlink tooltips, font names, text box properties.
const DRAWINGML_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/main';
// DrawingML in the strict form: the same seller text.
const STRICT_DRAWINGML_NAMESPACE = 'http://purl.oclc.org/ooxml/drawingml/main';
// DrawingML chart (`c`): chart values, series names and number formats.
const CHART_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
// DrawingML chart in the strict form: the same seller text.
const STRICT_CHART_NAMESPACE = 'http://purl.oclc.org/ooxml/drawingml/chart';
// Excel 2010 (`x14`): data validation prompts and errors, slicer and sparkline names.
const X14_NAMESPACE = 'http://schemas.microsoft.com/office/spreadsheetml/2009/9/main';
// Excel 2013 (`x15`): data model table and connection names, pivot item unique names.
const X15_NAMESPACE = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/main';
// Excel 2013 absolute path (`x15ac`): the folder the workbook was saved in (`absPath url`).
const X15AC_NAMESPACE = 'http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac';
// Excel revisions (`xr`): the revision pointer Excel writes into a workbook (`revisionPtr`).
const XR_NAMESPACE = 'http://schemas.microsoft.com/office/spreadsheetml/2014/revision';
const OFFICE_DATA_NAMESPACES: readonly string[] = [
  SPREADSHEETML_NAMESPACE,
  STRICT_SPREADSHEETML_NAMESPACE,
  SPREADSHEET_DRAWING_NAMESPACE,
  STRICT_SPREADSHEET_DRAWING_NAMESPACE,
  DRAWINGML_NAMESPACE,
  STRICT_DRAWINGML_NAMESPACE,
  CHART_NAMESPACE,
  STRICT_CHART_NAMESPACE,
  X14_NAMESPACE,
  X15_NAMESPACE,
  X15AC_NAMESPACE,
  XR_NAMESPACE,
];
// The key of the default namespace among the prefixes of NamespaceScopes.
const DEFAULT_NAMESPACE_KEY = '';
/** The most open elements the walk follows the nesting of (see the header). */
export const MAX_TRACKED_ELEMENT_DEPTH = 512;

/** The relationship ids a worksheet's own relationships part gives an external hyperlink (see the header). */
export interface WorksheetHyperlinkIds {
  /** The ids it gives an external hyperlink and nothing else: a hyperlink with one keeps a URL fragment in its `location`. */
  readonly onlyExternal: ReadonlySet<string>;
  /** The ids it gives an external hyperlink, among others or not: no element but a hyperlink may name one. */
  readonly external: ReadonlySet<string>;
}

/**
 * Per worksheet part name, the relationship ids its own relationships part gives an
 * external hyperlink (assertNoUnsafePackageParts reads them; see the header).
 */
export type ExternalHyperlinkIds = ReadonlyMap<string, WorksheetHyperlinkIds>;

/**
 * The step of the gate that content-scans a kept XML part, the one content scan it gets:
 * the package walk (assertNoUnsafePackageParts in unsafe-parts.ts, which scans the parts
 * it walks), or the content scan of every other kept part (assertSafeXmlContent).
 */
export type ContentScanStep = 'package-walk' | 'content-scan';

/** The ContentScanStep of each kept XML part, by name (contentScanPlan in unsafe-parts.ts). */
export type ContentScanPlan = ReadonlyMap<string, ContentScanStep>;

const NO_EXTERNAL_HYPERLINKS: ExternalHyperlinkIds = new Map();
/** The external hyperlink ids of a part that has none. */
export const NO_HYPERLINK_IDS: WorksheetHyperlinkIds = {
  onlyExternal: new Set(),
  external: new Set(),
};
// The plan of a content scan that scans every entry it is given.
const SCAN_EVERY_PART: ContentScanPlan = new Map();

/** Lower-case ASCII names, by length. */
type NameSet = ReadonlyMap<number, readonly string[]>;

/**
 * The namespaces the walk tells apart ('data': one of OFFICE_DATA_NAMESPACES; 'scripted':
 * one of EVENT_HANDLER_NAMESPACES); every other one is 'other'.
 */
type KnownNamespace = 'omml' | 'relationships' | 'data' | 'scripted' | 'other';

// The namespaces a declaration names when it holds one of these URIs byte for byte.
const KNOWN_NAMESPACES: readonly (readonly [uri: string, namespace: KnownNamespace])[] = [
  [OMML_NAMESPACE, 'omml'],
  [RELATIONSHIPS_NAMESPACE, 'relationships'],
  ...OFFICE_DATA_NAMESPACES.map((uri): readonly [string, KnownNamespace] => [uri, 'data']),
];

/** One namespace binding: the level of the element that declared it and the namespace it names. */
interface NamespaceBinding {
  readonly level: number;
  namespace: KnownNamespace;
}

/** An open element that declares namespaces. */
interface DeclaringElement {
  /** How many elements are open around it. */
  readonly level: number;
  /** The prefixes it bound (DEFAULT_NAMESPACE_KEY for the default namespace). */
  readonly prefixes: readonly string[];
  /** How many namespace declarations it holds. */
  readonly declarations: number;
}

/**
 * The namespace declarations in scope while one part is walked, in memory bounded by
 * MAX_TRACKED_ELEMENT_DEPTH and MAX_XMLNS_DECLARATIONS_PER_PART (see the header). A
 * declaration is compared byte for byte with the OMML and relationships namespaces and
 * the OFFICE_DATA_NAMESPACES: one written with a reference names another namespace. It
 * names an EVENT_HANDLER_NAMESPACES namespace ('scripted') when its decoded value is one,
 * or cannot be decoded. A prefix declared twice on one element names the OMML or
 * relationships namespace only when both declarations name it, an Office data namespace
 * ('data') only when both name one, and an event handler namespace when either does.
 */
interface NamespaceScopes {
  /** Per prefix (DEFAULT_NAMESPACE_KEY for the default namespace), its bindings, innermost last. */
  readonly bindings: Map<string, NamespaceBinding[]>;
  /** The open elements that declare namespaces, innermost last. */
  readonly declaring: DeclaringElement[];
  /** The qualified name of each open element, outermost first: its nameStart and nameEnd offsets. */
  readonly openNames: number[];
  /** How many elements are open. */
  depth: number;
  /** The namespace declarations in scope (see the header). */
  declarationsInScope: number;
  /** The walk lost the nesting of the part: no binding counts. */
  broken: boolean;
}

// The level of StyleText while the walk is inside no style element.
const OUTSIDE_STYLE = -1;

/** Where a CssScan stands after the `url(` it read last. */
type CssUrlPhase =
  // No `url(` target is being read.
  | 'none'
  // Past `url(`: CSS white space is skipped; a quote may follow.
  | 'open'
  // Past `url(` and a quote: CSS white space is skipped.
  | 'quoted';

/** What a '(' read by readCssName ends (see the CSS header): no call, a `url(`, or a call of a CSS_LOADING_FUNCTIONS function. */
type CssCall = 'none' | 'url' | 'loading';

/** Where a CssNameRun stands in a CSS escape. */
type CssEscapePhase =
  // In no escape.
  | 'none'
  // Past a backslash.
  | 'open'
  // Past a backslash and hexadecimal digits (`hexDigits` of them, worth `hexValue`).
  | 'hex'
  // Past a carriage return that ended an escape: a line feed right after it is part of it.
  | 'carriage-return';

/**
 * The run of CSS identifier code points that ends at the code unit read last, its escapes
 * decoded (see the CSS header), in constant memory: its last CSS_NAME_TAIL_LENGTH code
 * points, ASCII-folded, in a ring. Create with createCssNameRun, feed with readCssName.
 */
interface CssNameRun {
  /** The ring of its last code points; `next` is where the next one goes. */
  readonly tail: number[];
  next: number;
  /** How many code points the ring holds; 0 when no run ends at the code unit read last. */
  length: number;
  escape: CssEscapePhase;
  hexValue: number;
  hexDigits: number;
}

/**
 * CSS text read one piece at a time, in constant memory (see the CSS header): the end of
 * the identifier run its last code units spell, how much of `@import` they spell, ASCII
 * case ignored, where the target of its last `url(` stands, and, in a style, how the
 * text past its last quote starts. Create with createCssScan, feed with feedCss, end
 * with finishCss; `loads` once the text read so far loads a resource (loadsCssResource).
 */
interface CssScan {
  /** A style: a backslash anywhere, an `@import` and a quoted absolute URL load too. Any other attribute value: a backslash from its first `url(` on. */
  readonly style: boolean;
  /** How many code units of CSS_IMPORT the last code units spell. */
  importMatched: number;
  /** The identifier run that ends at the last code unit. */
  readonly name: CssNameRun;
  phase: CssUrlPhase;
  /** In a style, the start of the text past the last quote (the content of a string, when the quote opens one), read while `quotedPending`. */
  quoted: UrlStartReader;
  quotedPending: boolean;
  /** A `url(` was read. */
  urlSeen: boolean;
  loads: boolean;
}

/** The style element the walk is inside (see the header). */
interface StyleText {
  /** How many elements were open around the style element; OUTSIDE_STYLE for none. */
  level: number;
  /** Its CSS text read so far. */
  css: CssScan;
}

// Bytes of the loose element name check (looseLocalStart): the delimiters that end a
// name under any reading, and the prefix separator.
const TAG_CLOSE = 0x3e; // '>'
const SLASH = 0x2f;
const EQUALS = 0x3d;
const QUOTE = 0x22;
const APOSTROPHE = 0x27;
const COLON = 0x3a;
const UPPER_A = 0x41;
const UPPER_Z = 0x5a;
const ASCII_CASE_OFFSET = 0x20;

// The CSS a style may not hold (loadsCssResource), compared ASCII-folded. The pattern
// does not repeat its first code unit, which advanceMatch relies on.
const CSS_IMPORT = '@import';
// The function whose target the scan reads, and the CSS functions that load an image
// whatever they are given (see the header): an identifier run that ends with one of
// them, ASCII case ignored, names it (`-webkit-image-set` ends with `image-set`).
const CSS_URL_FUNCTION = 'url';
const CSS_LOADING_FUNCTIONS: readonly string[] = ['image-set', 'image', 'src', 'cross-fade'];
// How many code points of an identifier run CssNameRun keeps: the longest name it is
// compared with.
const CSS_NAME_TAIL_LENGTH = Math.max(
  CSS_URL_FUNCTION.length,
  ...CSS_LOADING_FUNCTIONS.map((name) => name.length),
);
// A backslash: a CSS escape. Its hexadecimal form holds at most this many digits.
const CSS_ESCAPE = 0x5c;
const MAX_CSS_HEX_DIGITS = 6;
// The code points of a CSS identifier besides ASCII letters and digits (see the header).
const HYPHEN = 0x2d;
const UNDERSCORE = 0x5f;
const FIRST_NON_ASCII = 0x80;
const LOWER_Z = 0x7a;
// CSS newlines: a backslash before one is no escape. A carriage return and the line
// feed right after it are one newline.
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const FORM_FEED = 0x0c;
// The bytes a value needs to hold a call once decoded: '(' itself, or the '&' of a reference.
const PARENTHESIS_OPEN = 0x28;
const AMPERSAND = 0x26;
// CSS white space (space, tab, line feed, carriage return, form feed) and quotes.
const CSS_SPACE: ReadonlySet<number> = new Set([0x20, 0x09, 0x0a, 0x0d, 0x0c]);
const CSS_QUOTES: ReadonlySet<number> = new Set([0x22, 0x27]);
// A CDATA section's delimiters: its text lies between them.
const CDATA_OPEN = '<![CDATA[';
const CDATA_CLOSE_LENGTH = 3;

// The scans read a kept XML part in UTF-8. A part that another reader decodes in
// another encoding could hold markup or a formula the scans never see (UTF-7 writes
// 'W' as `+AFc-`), so every kept XML part must be UTF-8 text: valid UTF-8, no U+0000
// (XML has none, and a UTF-16 or UTF-32 part without a byte order mark has one in every
// ASCII character), and, when its first markup is a processing instruction, one the
// strict lexer reads that is not an XML declaration, or an XML declaration (target
// exactly `xml`) that names no encoding but UTF-8 (the worksheet index's rule).
const NUL = 0x00;

const REFERENCE_OPEN = '&';
const REFERENCE_CLOSE = ';';
const PREDEFINED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);
// The longest predefined entity name.
const MAX_PREDEFINED_ENTITY_LENGTH = 4;
// A character reference: '#', then decimal digits, or 'x' and hexadecimal digits. A
// `url(` target that starts with '#' is a fragment of the document (see the CSS header).
const HASH = 0x23;
const LOWER_X = 0x78;
const DIGIT_ZERO = 0x30;
const DIGIT_NINE = 0x39;
const LOWER_A = 0x61;
const LOWER_F = 0x66;
const HEXADECIMAL_LETTER_BASE = 10;
const DECIMAL_RADIX = 10;
const HEXADECIMAL_RADIX = 16;
const NOT_A_DIGIT = -1;
const MAX_CODE_POINT = 0x10ffff;
// A field may start with U+FEFF, which the default decoder would drop.
const FIELD_DECODER = new TextDecoder('utf-8', { ignoreBOM: true });
// The literal white space an XML processor turns into one space in an attribute value
// (XML 1.0 sections 2.11 and 3.3.3): a CR LF pair, then a lone CR, LF or TAB.
const ATTRIBUTE_VALUE_BREAKS = /\r\n|[\t\n\r]/g;
const ATTRIBUTE_VALUE_SPACE = ' ';

/**
 * What the formula scan of one upload has read and may read, in UTF-16 code units: every
 * formula field it scans, raw plus its NFKC form when that differs, in every part together
 * (see the formula field header). Create with createFormulaScanBudget.
 */
export interface FormulaScanBudget {
  /** MAX_FORMULA_SCAN_UNITS, or lower. */
  readonly limit: number;
  used: number;
}

/** What the first bytes of a zip entry say it holds (see "Which entries are XML"). */
export type EntryContentKind = 'xml' | 'other' | 'misencoded';

/**
 * The first bytes of one entry, read chunk by chunk: `kind` is null until they decide.
 * Create with createEntryContentSniff; feed with feedEntryContentSniff.
 */
export interface EntryContentSniff {
  kind: EntryContentKind | null;
  /** The first bytes, held until the byte order mark is read. */
  readonly head: number[];
  headRead: boolean;
  /** The last leading byte (white space or U+0000) before the first other byte; NO_BYTE for none. */
  previous: number;
  /** The first other byte was '<'; the byte after it decides. */
  open: boolean;
}

function nameSet(names: readonly string[]): NameSet {
  const byLength = new Map<number, string[]>();
  for (const name of names) {
    const folded = foldAsciiCase(name);
    const sameLength = byLength.get(folded.length) ?? [];
    sameLength.push(folded);
    byLength.set(folded.length, sameLength);
  }
  return byLength;
}

const FORMULA_ELEMENTS = nameSet(FORMULA_ELEMENT_NAMES);
const FORMULA_ATTRIBUTES = nameSet(FORMULA_ATTRIBUTE_NAMES);
const ELEMENT_FORMULA_ATTRIBUTES: readonly (readonly [element: NameSet, attribute: NameSet])[] =
  ELEMENT_FORMULA_ATTRIBUTE_NAMES.map<readonly [NameSet, NameSet]>(([element, attribute]) => [
    nameSet([element]),
    nameSet([attribute]),
  ]);
// Every element that carries a field attribute of its own.
const FIELD_ATTRIBUTE_ELEMENTS = nameSet(
  ELEMENT_FORMULA_ATTRIBUTE_NAMES.map(([element]) => element),
);
const PIVOT_FORMULA_ELEMENTS = nameSet(PIVOT_FORMULA_ELEMENT_NAMES);
const PIVOT_FORMULA_ATTRIBUTE = nameSet([PIVOT_FORMULA_ATTRIBUTE_NAME]);
const INNER_FORMULA_ELEMENT = nameSet([INNER_FORMULA_ELEMENT_NAME]);
const URL_FRAGMENT_ELEMENTS = nameSet(URL_FRAGMENT_ELEMENT_NAMES);
const RELATIONSHIP_IDS = nameSet([RELATIONSHIP_ID_ATTRIBUTE]);
const MACRO_ATTRIBUTES = nameSet(MACRO_ATTRIBUTE_NAMES);
const MACRO_ELEMENTS = nameSet(MACRO_ELEMENT_NAMES);
const SCRIPT_ELEMENTS = nameSet(SCRIPT_ELEMENT_NAMES);
const URL_ATTRIBUTES = nameSet(URL_ATTRIBUTE_NAMES);
const BASE_URL_ATTRIBUTES = nameSet(BASE_URL_ATTRIBUTE_NAMES);
const STYLES = nameSet(STYLE_NAMES);
const STYLESHEET_INSTRUCTIONS = nameSet(STYLESHEET_INSTRUCTION_NAMES);
const ACTIVE_ELEMENTS = nameSet(ACTIVE_ELEMENT_NAMES);
const SVG_ROOT = nameSet([SVG_ROOT_NAME]);
const SVG_ANIMATION_ELEMENTS = nameSet(SVG_ANIMATION_ELEMENT_NAMES);
const WEB_RESOURCE_ATTRIBUTES = nameSet(WEB_RESOURCE_ATTRIBUTE_NAMES);

/** Whether the entry `name` is one the grid reader may open: named `.xml` or `.xml.rels`. */
export function isXmlPart(name: string): boolean {
  return XML_PART_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

function foldAsciiByte(byte: number | undefined): number | undefined {
  if (byte === undefined || byte < UPPER_A || byte > UPPER_Z) return byte;
  return byte + ASCII_CASE_OFFSET;
}

/** Whether the bytes from `start` spell `lowerName` (lower-case ASCII), ignoring ASCII case. */
function spellsFolded(bytes: Uint8Array, start: number, lowerName: string): boolean {
  for (let index = 0; index < lowerName.length; index += 1) {
    if (foldAsciiByte(bytes[start + index]) !== lowerName.charCodeAt(index)) return false;
  }
  return true;
}

/** Whether bytes [start, end) start with `lowerPrefix` (lower-case ASCII), ignoring ASCII case. */
function startsWithFolded(
  bytes: Uint8Array,
  start: number,
  end: number,
  lowerPrefix: string,
): boolean {
  return end - start >= lowerPrefix.length && spellsFolded(bytes, start, lowerPrefix);
}

/** Whether bytes [start, end) spell a name of `names`, ignoring ASCII case. Nothing is allocated. */
function isNameIn(bytes: Uint8Array, start: number, end: number, names: NameSet): boolean {
  const candidates = names.get(end - start);
  if (candidates === undefined) return false;
  for (const name of candidates) {
    if (spellsFolded(bytes, start, name)) return true;
  }
  return false;
}

function unsafeFormula(
  detail: UnsafeContentDetail,
  entry: string,
  message: string,
): SpreadsheetFileError {
  return unsafeContentError(UNSAFE_CONTENT_REASONS.UNSAFE_FORMULA, detail, entry, message);
}

function unsafePart(
  detail: UnsafeContentDetail,
  entry: string,
  message: string,
): SpreadsheetFileError {
  return unsafeContentError(UNSAFE_CONTENT_REASONS.UNSAFE_PART, detail, entry, message);
}

/** CORRUPT_FILE `package-part` for part `entry`: an attribute value holds a reference the scan cannot decode (see the header). */
function undecodableAttribute(entry: string): SpreadsheetFileError {
  return packagePartError(entry, 'holds an attribute value the scan cannot decode');
}

/**
 * UNSAFE_CONTENT `{ detail: 'namespace-declarations', entry, cap }`: part `entry` holds
 * more than MAX_XMLNS_DECLARATIONS_PER_PART namespace declarations. The one error both the
 * content scan of every kept XML part and the budget of the reader parts raise.
 */
export function tooManyNamespaceDeclarations(entry: string): SpreadsheetFileError {
  return new SpreadsheetFileError(
    'UNSAFE_CONTENT',
    `Workbook part '${entry}' has more than ${MAX_XMLNS_DECLARATIONS_PER_PART} namespace declarations`,
    {
      detail: UNSAFE_CONTENT_DETAILS.NAMESPACE_DECLARATIONS,
      entry,
      cap: MAX_XMLNS_DECLARATIONS_PER_PART,
    },
  );
}

/** A new sniff for one entry, nothing read yet. */
export function createEntryContentSniff(): EntryContentSniff {
  return { kind: null, head: [], headRead: false, previous: NO_BYTE, open: false };
}

function startsWithBytes(bytes: readonly number[], prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

/** Reads one byte after the byte order mark; decides `kind` at the first byte that is not white space or U+0000. */
function sniffLeadingByte(sniff: EntryContentSniff, byte: number): void {
  if (sniff.open) {
    sniff.kind = byte === NUL ? 'misencoded' : 'xml';
    return;
  }
  if (byte === TAG_OPEN) {
    if (sniff.previous === NUL) sniff.kind = 'misencoded';
    else sniff.open = true;
    return;
  }
  if (byte === NUL || isXmlSpace(byte)) {
    sniff.previous = byte;
    return;
  }
  sniff.kind = 'other';
}

/** Reads the held first bytes: a UTF-16 or UTF-32 mark or an EBCDIC declaration decides, a UTF-8 mark is skipped. */
function readHead(sniff: EntryContentSniff): void {
  sniff.headRead = true;
  const misencoded =
    OTHER_BYTE_ORDER_MARKS.some((mark) => startsWithBytes(sniff.head, mark)) ||
    startsWithBytes(sniff.head, EBCDIC_DECLARATION_START);
  if (misencoded) {
    sniff.kind = 'misencoded';
    return;
  }
  const skip = startsWithBytes(sniff.head, UTF8_BYTE_ORDER_MARK) ? UTF8_BYTE_ORDER_MARK.length : 0;
  for (let index = skip; index < sniff.head.length && sniff.kind === null; index += 1) {
    sniffLeadingByte(sniff, sniff.head[index] ?? NUL);
  }
}

/** Reads the next chunk of the entry; stops at the byte that decides. */
export function feedEntryContentSniff(sniff: EntryContentSniff, chunk: Uint8Array): void {
  for (const byte of chunk) {
    if (sniff.kind !== null) return;
    if (sniff.headRead) {
      sniffLeadingByte(sniff, byte);
      continue;
    }
    sniff.head.push(byte);
    if (sniff.head.length === BYTE_ORDER_MARK_LENGTH) readHead(sniff);
  }
}

/**
 * Decides `sniff.kind` once all of the entry was fed and returns it: a '<' that ends the
 * entry is XML, bytes that never decided (white space only, or nothing) are not.
 */
export function finishEntryContentSniff(sniff: EntryContentSniff): EntryContentKind {
  if (!sniff.headRead) readHead(sniff);
  const kind = sniff.kind ?? (sniff.open ? 'xml' : 'other');
  sniff.kind = kind;
  return kind;
}

/** The kind of a whole entry `bytes`. */
export function entryContentKind(bytes: Uint8Array): EntryContentKind {
  const sniff = createEntryContentSniff();
  feedEntryContentSniff(sniff, bytes);
  return finishEntryContentSniff(sniff);
}

/** CORRUPT_FILE `{ reason: 'part-encoding', entry }`, the message `Workbook part <detail>`. */
function partEncodingError(entry: string, detail: string): SpreadsheetFileError {
  return new SpreadsheetFileError('CORRUPT_FILE', `Workbook part ${detail}`, {
    reason: ZIP_REJECT_REASONS.PART_ENCODING,
    entry: metaEntryName(entry),
  });
}

/**
 * Throws CORRUPT_FILE `{ reason: 'part-encoding', entry }` for entry `name` of `kind`
 * when it is XML the scans cannot read (`misencoded`), or not XML while its ASCII-folded
 * name ends in `.xml`, `.rels` or `.vml` (see "Which entries are XML").
 */
export function assertEntryContentKind(name: string, kind: EntryContentKind): void {
  if (kind === 'misencoded') {
    throw partEncodingError(name, 'is UTF-16, UTF-32 or EBCDIC text, which the scans cannot read');
  }
  if (kind === 'xml') return;
  const folded = foldAsciiCase(name);
  if (XML_CONTENT_NAME_SUFFIXES.some((suffix) => folded.endsWith(suffix))) {
    throw partEncodingError(name, 'is named for XML content but does not hold XML');
  }
}

/** Reads the markup at the '<' at `at` into `markup` and `attributes`; false when the strict lexer refuses it. */
function lexes(bytes: Uint8Array, at: number, markup: XmlMarkup, attributes?: number[]): boolean {
  try {
    scanMarkup(bytes, at, markup, attributes);
    return true;
  } catch (error) {
    if (error instanceof XmlLexError) return false;
    throw error;
  }
}

/** The value of digit `code` in `radix` (10, or 16 with letters in either case), or NOT_A_DIGIT. */
function digitValue(code: number, radix: number): number {
  if (code >= DIGIT_ZERO && code <= DIGIT_NINE) return code - DIGIT_ZERO;
  if (radix !== HEXADECIMAL_RADIX) return NOT_A_DIGIT;
  const lower = foldAsciiByte(code) ?? NOT_A_DIGIT;
  if (lower >= LOWER_A && lower <= LOWER_F) return lower - LOWER_A + HEXADECIMAL_LETTER_BASE;
  return NOT_A_DIGIT;
}

/**
 * The character the reference whose name is `text` [start, end) (between '&' and ';')
 * stands for: a predefined entity, or a decimal (`#87`) or hexadecimal (`#x57`)
 * character reference up to U+10FFFF. Null for any other name. Read by hand, one pass,
 * so a reference with millions of digits costs one look at each.
 */
function referenceText(text: string, start: number, end: number): string | null {
  if (end - start <= MAX_PREDEFINED_ENTITY_LENGTH) {
    const predefined = PREDEFINED_ENTITIES.get(text.slice(start, end));
    if (predefined !== undefined) return predefined;
  }
  if (text.charCodeAt(start) !== HASH) return null;
  const hexadecimal = text.charCodeAt(start + 1) === LOWER_X;
  const radix = hexadecimal ? HEXADECIMAL_RADIX : DECIMAL_RADIX;
  const digitsStart = hexadecimal ? start + 2 : start + 1;
  if (digitsStart >= end) return null;
  let codePoint = 0;
  for (let at = digitsStart; at < end; at += 1) {
    const digit = digitValue(text.charCodeAt(at), radix);
    if (digit === NOT_A_DIGIT) return null;
    codePoint = codePoint * radix + digit;
    if (codePoint > MAX_CODE_POINT) return null;
  }
  return String.fromCodePoint(codePoint);
}

/**
 * The text of raw XML character data or attribute value bytes `raw`, decoded from UTF-8
 * with every predefined and character reference replaced; null when it holds any other
 * reference (its text is unknown).
 */
export function decodeXmlText(raw: Uint8Array): string | null {
  return replaceReferences(FIELD_DECODER.decode(raw));
}

/**
 * The value an XML processor reads from raw attribute value bytes `raw` (XML 1.0 sections
 * 2.11 and 3.3.3): each literal CR LF pair, CR, LF and TAB turned into one space, then
 * every predefined and character reference replaced (a referenced line break stays one);
 * null when it holds any other reference.
 */
function attributeValueText(raw: Uint8Array): string | null {
  return replaceReferences(
    FIELD_DECODER.decode(raw).replace(ATTRIBUTE_VALUE_BREAKS, ATTRIBUTE_VALUE_SPACE),
  );
}

/** `text` with every predefined and character reference replaced; null when it holds any other reference. */
function replaceReferences(text: string): string | null {
  let decoded = '';
  let from = 0;
  for (
    let open = text.indexOf(REFERENCE_OPEN);
    open !== -1;
    open = text.indexOf(REFERENCE_OPEN, from)
  ) {
    const close = text.indexOf(REFERENCE_CLOSE, open + 1);
    const character = close === -1 ? null : referenceText(text, open + 1, close);
    if (character === null) return null;
    decoded += text.slice(from, open) + character;
    from = close + 1;
  }
  return decoded + text.slice(from);
}

/**
 * A formula scan budget of `limit` code units (MAX_FORMULA_SCAN_UNITS by default; a
 * higher limit is clamped to it), nothing read yet.
 */
export function createFormulaScanBudget(limit = MAX_FORMULA_SCAN_UNITS): FormulaScanBudget {
  return { limit: Math.min(limit, MAX_FORMULA_SCAN_UNITS), used: 0 };
}

/**
 * Adds the code units of formula field `readings` to `budget` before they are read: its
 * raw text, plus its NFKC form only when that differs (formulaReadingsRefusal reads the
 * NFKC form only then). PAYLOAD_TOO_LARGE `{ reason: 'formula-scan-budget', entry, cap }`
 * when the upload's fields together go past its limit.
 */
function chargeFormulaScan(
  entry: string,
  budget: FormulaScanBudget,
  readings: FormulaReadings,
): void {
  budget.used +=
    readings.text.length + (readings.normal === readings.text ? 0 : readings.normal.length);
  if (budget.used <= budget.limit) return;
  throw new SpreadsheetFileError(
    'PAYLOAD_TOO_LARGE',
    `Workbook formula fields exceed ${budget.limit} code units to scan`,
    {
      reason: UPLOAD_LIMIT_REASONS.FORMULA_SCAN_BUDGET,
      entry: metaEntryName(entry),
      cap: budget.limit,
    },
  );
}

/**
 * Decodes formula field bytes `raw` and checks them (formula-scan.ts), its quoted
 * sections read as `quoted`, charging `budget` before they are read; UNSAFE_CONTENT
 * `unsafe-formula` otherwise (a field longer than MAX_FORMULA_TEXT_LENGTH, raw or in
 * NFKC form, included), PAYLOAD_TOO_LARGE past the budget (chargeFormulaScan).
 */
function assertSafeFormulaField(
  entry: string,
  raw: Uint8Array,
  budget: FormulaScanBudget,
  quoted: QuotedSection = 'sheet-name',
): void {
  const text = decodeXmlText(raw);
  if (text === null) {
    throw unsafeFormula(
      UNSAFE_CONTENT_DETAILS.FORMULA,
      entry,
      'Workbook part holds a formula with a reference the scan cannot decode',
    );
  }
  const readings = formulaReadings(text);
  if (typeof readings === 'string')
    throw unsafeFormula(UNSAFE_CONTENT_DETAILS.FORMULA, entry, readings);
  chargeFormulaScan(entry, budget, readings);
  const refusal = formulaReadingsRefusal(readings, quoted);
  if (refusal !== null) throw unsafeFormula(UNSAFE_CONTENT_DETAILS.FORMULA, entry, refusal);
}

function notTextOnly(entry: string): SpreadsheetFileError {
  return unsafeFormula(
    UNSAFE_CONTENT_DETAILS.FORMULA,
    entry,
    'Workbook part holds a formula field with something other than text',
  );
}

/** Whether the end tag scanned into `markup` closes the element named by bytes [nameStart, nameEnd). */
function closesElement(
  bytes: Uint8Array,
  markup: XmlMarkup,
  nameStart: number,
  nameEnd: number,
): boolean {
  const nameLength = nameEnd - nameStart;
  return (
    markup.kind === 'end' &&
    markup.nameEnd - markup.nameStart === nameLength &&
    bytesEqualAt(bytes, nameStart, bytes, markup.nameStart, nameLength)
  );
}

/**
 * The offset of the end tag of the element whose start tag is scanned into `markup`,
 * which must follow its content directly: text only, no other markup. The end tag is
 * left in `markup`. UNSAFE_CONTENT `unsafe-formula` otherwise.
 */
function textOnlyContentEnd(entry: string, bytes: Uint8Array, markup: XmlMarkup): number {
  const nameStart = markup.nameStart;
  const nameEnd = markup.nameEnd;
  const close = nextMarkup(bytes, markup.end);
  const textOnly =
    close !== -1 && lexes(bytes, close, markup) && closesElement(bytes, markup, nameStart, nameEnd);
  if (!textOnly) throw notTextOnly(entry);
  return close;
}

/** Whether bytes [start, end) are XML white space only. */
function isXmlSpaceOnly(bytes: Uint8Array, start: number, end: number): boolean {
  for (let at = start; at < end; at += 1) {
    if (!isXmlSpace(bytes[at])) return false;
  }
  return true;
}

/**
 * Checks the content of the formula field element whose start tag is scanned into
 * `markup`, up to its own end tag (left in `markup`): text that passes the scan, or
 * exactly one child element whose local name is `f`, with safe attributes and text only
 * that passes the scan, and nothing but white space around it (see the header).
 * UNSAFE_CONTENT `unsafe-formula` otherwise.
 */
function assertSafeFieldContent(
  entry: string,
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: number[],
  budget: FormulaScanBudget,
): void {
  const nameStart = markup.nameStart;
  const nameEnd = markup.nameEnd;
  const contentStart = markup.end;
  const next = nextMarkup(bytes, contentStart);
  if (next === -1 || !lexes(bytes, next, markup, attributes)) throw notTextOnly(entry);
  if (closesElement(bytes, markup, nameStart, nameEnd)) {
    assertSafeFormulaField(entry, bytes.subarray(contentStart, next), budget);
    return;
  }
  const innerChild =
    markup.kind === 'start' &&
    isNameIn(bytes, localNameStart(bytes, markup), markup.nameEnd, INNER_FORMULA_ELEMENT) &&
    isXmlSpaceOnly(bytes, contentStart, next);
  if (!innerChild) throw notTextOnly(entry);
  assertNoWebContent(entry, bytes, markup, attributes);
  // The walk does not follow the child's own declarations: it is never a data element.
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    assertSafeAttribute(
      entry,
      bytes,
      attributes,
      attribute,
      null,
      'sheet-name',
      false,
      false,
      budget,
    );
  }
  const innerStart = markup.end;
  const innerClose = textOnlyContentEnd(entry, bytes, markup);
  assertSafeFormulaField(entry, bytes.subarray(innerStart, innerClose), budget);
  const innerEnd = markup.end;
  const close = nextMarkup(bytes, innerEnd);
  const closed =
    close !== -1 &&
    isXmlSpaceOnly(bytes, innerEnd, close) &&
    lexes(bytes, close, markup) &&
    closesElement(bytes, markup, nameStart, nameEnd);
  if (!closed) throw notTextOnly(entry);
}

/**
 * Reads the content of the script element whose start tag is scanned into `markup` up
 * to its own end tag (left in `markup`): white space only, or UNSAFE_CONTENT
 * `unsafe-formula`.
 */
function assertNoScript(entry: string, bytes: Uint8Array, markup: XmlMarkup): void {
  const nameStart = markup.nameStart;
  const nameEnd = markup.nameEnd;
  const contentStart = markup.end;
  const close = nextMarkup(bytes, contentStart);
  const empty =
    close !== -1 &&
    isXmlSpaceOnly(bytes, contentStart, close) &&
    lexes(bytes, close, markup) &&
    closesElement(bytes, markup, nameStart, nameEnd);
  if (!empty)
    throw unsafeFormula(UNSAFE_CONTENT_DETAILS.SCRIPT, entry, 'Workbook part holds a script');
}

/**
 * Whether decoded URL text `text` is a `data:` URI of a raster image (see the header):
 * DATA_URL_SCHEME, then one of DATA_IMAGE_MEDIA_TYPES up to the first of
 * DATA_MEDIA_TYPE_ENDS, ASCII case ignored.
 */
function isRasterDataImage(text: string): boolean {
  if (foldAsciiCase(text.slice(0, DATA_URL_SCHEME.length)) !== DATA_URL_SCHEME) return false;
  for (let at = DATA_URL_SCHEME.length; at < text.length; at += 1) {
    if (!DATA_MEDIA_TYPE_ENDS.includes(text.charAt(at))) continue;
    return DATA_IMAGE_MEDIA_TYPES.includes(foldAsciiCase(text.slice(DATA_URL_SCHEME.length, at)));
  }
  return false;
}

/**
 * Decodes URL attribute value bytes `raw`: a relative URL, or, with `dataImage` (a URL
 * attribute of an IMAGE_ELEMENT_NAMES element), a raster image `data:` URI
 * (isRasterDataImage); UNSAFE_CONTENT `unsafe-part` otherwise, CORRUPT_FILE
 * `package-part` when it cannot be decoded.
 */
function assertRelativeUrl(entry: string, raw: Uint8Array, dataImage: boolean): void {
  const text = decodeXmlText(raw);
  if (text === null) throw undecodableAttribute(entry);
  if (dataImage && isRasterDataImage(text)) return;
  if (isAbsoluteUrl(text)) {
    throw unsafePart(
      UNSAFE_CONTENT_DETAILS.EXTERNAL_URL,
      entry,
      'Workbook part links to a resource outside the package',
    );
  }
}

/** A new CssNameRun, nothing read yet. */
function createCssNameRun(): CssNameRun {
  return {
    tail: new Array<number>(CSS_NAME_TAIL_LENGTH).fill(NUL),
    next: 0,
    length: 0,
    escape: 'none',
    hexValue: 0,
    hexDigits: 0,
  };
}

/** Whether `code` is a CSS identifier code point: an ASCII letter or digit, '-', '_', or any non-ASCII code point. */
function isCssNameCode(code: number): boolean {
  const folded = foldAsciiByte(code) ?? code;
  return (
    (folded >= LOWER_A && folded <= LOWER_Z) ||
    (code >= DIGIT_ZERO && code <= DIGIT_NINE) ||
    code === HYPHEN ||
    code === UNDERSCORE ||
    code >= FIRST_NON_ASCII
  );
}

/** Adds code point `code`, ASCII-folded, to the end of `run`. */
function appendCssName(run: CssNameRun, code: number): void {
  run.tail[run.next] = foldAsciiByte(code) ?? code;
  run.next = (run.next + 1) % CSS_NAME_TAIL_LENGTH;
  run.length = Math.min(run.length + 1, CSS_NAME_TAIL_LENGTH);
}

/** Whether the decoded, ASCII-folded run `run` ends with `lowerName` (lower-case ASCII). */
function cssNameEndsWith(run: CssNameRun, lowerName: string): boolean {
  if (lowerName.length > run.length) return false;
  const start = run.next - lowerName.length + CSS_NAME_TAIL_LENGTH;
  for (let index = 0; index < lowerName.length; index += 1) {
    const code = run.tail[(start + index) % CSS_NAME_TAIL_LENGTH];
    if (code !== lowerName.charCodeAt(index)) return false;
  }
  return true;
}

/** The call a '(' right after `run` makes (see the CSS header). */
function cssCallOf(run: CssNameRun): CssCall {
  if (cssNameEndsWith(run, CSS_URL_FUNCTION)) return 'url';
  return CSS_LOADING_FUNCTIONS.some((name) => cssNameEndsWith(run, name)) ? 'loading' : 'none';
}

/**
 * Reads `code` right after a backslash of `run`: a newline is no escape and adds nothing
 * (the run goes on), a hexadecimal digit starts a code point, any other code point
 * stands for itself.
 */
function readEscapeStart(run: CssNameRun, code: number): void {
  run.escape = 'none';
  if (code === CARRIAGE_RETURN) {
    run.escape = 'carriage-return';
    return;
  }
  if (code === LINE_FEED || code === FORM_FEED) return;
  const digit = digitValue(code, HEXADECIMAL_RADIX);
  if (digit === NOT_A_DIGIT) {
    appendCssName(run, code);
    return;
  }
  run.escape = 'hex';
  run.hexValue = digit;
  run.hexDigits = 1;
}

/**
 * Reads `code` past the hexadecimal digits of an escape of `run`: one more digit, up to
 * MAX_CSS_HEX_DIGITS; otherwise the escape ends with the code point they spell, and one
 * CSS white space right after it is part of it. Whether `code` was part of the escape.
 */
function readHexEscape(run: CssNameRun, code: number): boolean {
  const digit = digitValue(code, HEXADECIMAL_RADIX);
  if (digit !== NOT_A_DIGIT && run.hexDigits < MAX_CSS_HEX_DIGITS) {
    run.hexValue = run.hexValue * HEXADECIMAL_RADIX + digit;
    run.hexDigits += 1;
    return true;
  }
  run.escape = 'none';
  appendCssName(run, run.hexValue);
  if (code === CARRIAGE_RETURN) {
    run.escape = 'carriage-return';
    return true;
  }
  return CSS_SPACE.has(code);
}

/**
 * Reads code unit `code` into `run` (see the CSS header): the call a '(' makes right
 * after the run, 'none' for any other code unit. Constant time and memory.
 */
function readCssName(run: CssNameRun, code: number): CssCall {
  const escape = run.escape;
  switch (escape) {
    case 'none':
      break;
    case 'open':
      readEscapeStart(run, code);
      return 'none';
    case 'hex':
      if (readHexEscape(run, code)) return 'none';
      break;
    case 'carriage-return':
      run.escape = 'none';
      if (code === LINE_FEED) return 'none';
      break;
    default: {
      const _exhaustive: never = escape;
      throw new Error(`Unhandled CSS escape phase: ${String(_exhaustive)}`);
    }
  }
  if (code === CSS_ESCAPE) {
    run.escape = 'open';
    return 'none';
  }
  if (isCssNameCode(code)) {
    appendCssName(run, code);
    return 'none';
  }
  const call = code === PARENTHESIS_OPEN ? cssCallOf(run) : 'none';
  run.length = 0;
  return call;
}

/** A new CssScan, nothing read yet; `style` says whether the text is a style (see CssScan). */
function createCssScan(style: boolean): CssScan {
  return {
    style,
    importMatched: 0,
    name: createCssNameRun(),
    phase: 'none',
    quoted: createUrlStartReader(),
    quotedPending: false,
    urlSeen: false,
    loads: false,
  };
}

/**
 * How many code units of `pattern` the text spells after `code` (folded), given that it
 * spelled `matched` of them before. Exact for a pattern whose first code unit does not
 * repeat in it (CSS_IMPORT): no shorter match can then be pending.
 */
function advanceMatch(pattern: string, matched: number, code: number): number {
  if (code === pattern.charCodeAt(matched)) return matched + 1;
  return code === pattern.charCodeAt(0) ? 1 : 0;
}

/**
 * Reads `code` into the target of the last `url(` (see the CSS header): past CSS white
 * space, an optional quote and CSS white space again, a '#' passes and anything else
 * loads. Either decides the target, so one is pending at a time.
 */
function readCssUrlTarget(scan: CssScan, code: number): void {
  const phase = scan.phase;
  switch (phase) {
    case 'none':
      return;
    case 'open':
      if (CSS_SPACE.has(code)) return;
      if (CSS_QUOTES.has(code)) {
        scan.phase = 'quoted';
        return;
      }
      break;
    case 'quoted':
      if (CSS_SPACE.has(code)) return;
      break;
    default: {
      const _exhaustive: never = phase;
      throw new Error(`Unhandled CSS url phase: ${String(_exhaustive)}`);
    }
  }
  scan.phase = 'none';
  if (code !== HASH) scan.loads = true;
}

/**
 * Reads `code` of a style into the start of the text past its last quote (see the CSS
 * header): an absolute one loads (readUrlStart). A quote starts that text anew, so one
 * is pending at a time.
 */
function readQuotedStart(scan: CssScan, code: number): void {
  if (scan.quotedPending) {
    const verdict = readUrlStart(scan.quoted, code);
    if (verdict === 'absolute') scan.loads = true;
    if (verdict !== 'pending') scan.quotedPending = false;
  }
  if (!CSS_QUOTES.has(code)) return;
  scan.quoted = createUrlStartReader();
  scan.quotedPending = true;
}

/** Reads code unit `code` of the CSS of `scan` (see the CSS header). */
function readCssCode(scan: CssScan, code: number): void {
  if (code === CSS_ESCAPE && (scan.style || scan.urlSeen)) {
    scan.loads = true;
    return;
  }
  readCssUrlTarget(scan, code);
  if (scan.style) readQuotedStart(scan, code);
  const call = readCssName(scan.name, code);
  switch (call) {
    case 'none':
      break;
    case 'url':
      scan.urlSeen = true;
      scan.phase = 'open';
      break;
    case 'loading':
      scan.loads = true;
      break;
    default: {
      const _exhaustive: never = call;
      throw new Error(`Unhandled CSS call: ${String(_exhaustive)}`);
    }
  }
  if (!scan.style) return;
  scan.importMatched = advanceMatch(CSS_IMPORT, scan.importMatched, foldAsciiByte(code) ?? code);
  if (scan.importMatched === CSS_IMPORT.length) scan.loads = true;
}

/** Reads the next piece `text` of the CSS of `scan`, up to the code unit that makes it load. */
function feedCss(scan: CssScan, text: string): void {
  for (let at = 0; at < text.length && !scan.loads; at += 1) {
    readCssCode(scan, text.charCodeAt(at));
  }
}

/** Ends the CSS of `scan`: a text that ends inside a `url(` target loads (an empty target). */
function finishCss(scan: CssScan): void {
  if (scan.phase !== 'none') scan.loads = true;
}

/**
 * Whether decoded CSS text `css` may load a resource (see the CSS header): a `url(` whose
 * target does not start with '#', or a call of a CSS_LOADING_FUNCTIONS function, either
 * read with its escapes decoded (CssNameRun); in a `style`, also a backslash anywhere, an
 * `@import` or a quoted absolute URL, and in any other attribute value a backslash from
 * its first `url(` on. ASCII case is ignored. One pass (feedCss); a style element's text
 * is fed piece by piece instead.
 */
function loadsCssResource(css: string, style: boolean): boolean {
  const scan = createCssScan(style);
  feedCss(scan, css);
  finishCss(scan);
  return scan.loads;
}

/**
 * Decodes style attribute value bytes `raw`: CSS that loads nothing, or UNSAFE_CONTENT
 * `unsafe-part`; CORRUPT_FILE `package-part` when it cannot be decoded.
 */
function assertSafeStyleAttribute(entry: string, raw: Uint8Array): void {
  const text = decodeXmlText(raw);
  if (text === null) throw undecodableAttribute(entry);
  if (loadsCssResource(text, true)) {
    throw unsafePart(
      UNSAFE_CONTENT_DETAILS.CSS_LOAD,
      entry,
      'Workbook part holds a style that loads a resource',
    );
  }
}

/**
 * The broad rule (see the header): the value bytes `raw` of an attribute that is no
 * style and no Excel data attribute (assertSafeAttribute) hold no CSS that loads a
 * resource (loadsCssResource), or UNSAFE_CONTENT `unsafe-part` `css-load-attribute`;
 * CORRUPT_FILE `package-part` when they cannot be decoded. Only a value with a '(' or a
 * reference can hold a call once decoded, so no other is decoded.
 */
function assertNoCssUrl(entry: string, raw: Uint8Array): void {
  if (!raw.includes(PARENTHESIS_OPEN) && !raw.includes(AMPERSAND)) return;
  const text = decodeXmlText(raw);
  if (text === null) throw undecodableAttribute(entry);
  if (loadsCssResource(text, false)) {
    throw unsafePart(
      UNSAFE_CONTENT_DETAILS.CSS_LOAD_ATTRIBUTE,
      entry,
      'Workbook part holds CSS that loads a resource',
    );
  }
}

/**
 * The value bytes `raw` of an attribute the broad CSS rule skips (an Excel data
 * attribute, see assertSafeAttribute) can be decoded, or CORRUPT_FILE `package-part`.
 * Only a value with a reference can fail to decode, so no other is decoded.
 */
function assertDecodableAttribute(entry: string, raw: Uint8Array): void {
  if (!raw.includes(AMPERSAND)) return;
  if (decodeXmlText(raw) === null) throw undecodableAttribute(entry);
}

/** Whether the attribute whose local name is bytes [start, end) names a URL: `src`, or any name that ends with `href` (ASCII case ignored). */
function isUrlAttributeName(bytes: Uint8Array, start: number, end: number): boolean {
  if (isNameIn(bytes, start, end, URL_ATTRIBUTES)) return true;
  const suffixStart = end - URL_ATTRIBUTE_SUFFIX.length;
  return suffixStart >= start && spellsFolded(bytes, suffixStart, URL_ATTRIBUTE_SUFFIX);
}

/** Whether attribute name bytes [start, end) declare a namespace: `xmlns` or `xmlns:` and a prefix. */
function isNamespaceDeclaration(bytes: Uint8Array, start: number, end: number): boolean {
  if (bytesEqualAscii(bytes, start, end, NAMESPACE_DECLARATION)) return true;
  const prefixEnd = start + NAMESPACE_DECLARATION_PREFIX.length;
  return end > prefixEnd && bytesEqualAscii(bytes, start, prefixEnd, NAMESPACE_DECLARATION_PREFIX);
}

/** Where the local part of name bytes [start, end) starts: past its last ':'. */
function localPartStart(bytes: Uint8Array, start: number, end: number): number {
  let local = start;
  for (let at = start; at < end; at += 1) {
    if (bytes[at] === COLON) local = at + 1;
  }
  return local;
}

/**
 * Checks attribute `attribute` of the scanned tag: a formula field (a FORMULA_ATTRIBUTES
 * attribute, or the `elementField` attribute of this element) passes the scan, its
 * `formula` attribute read with quoted sections as `formulaQuotes`; a macro is empty; a
 * style loads nothing; any other value holds no CSS that loads a resource, but for an
 * unprefixed attribute of a `dataElement` (an element of an OFFICE_DATA_NAMESPACES
 * namespace read before the part's first web content and outside a style element),
 * which must only decode; and a URL attribute is relative, or a raster image data URI
 * on an `imageElement` (an IMAGE_ELEMENT_NAMES element), a base URL relative. A field
 * is charged to `budget`.
 */
function assertSafeAttribute(
  entry: string,
  bytes: Uint8Array,
  attributes: readonly number[],
  attribute: number,
  elementField: NameSet | null,
  formulaQuotes: QuotedSection,
  imageElement: boolean,
  dataElement: boolean,
  budget: FormulaScanBudget,
): void {
  const nameStart = attributeField(attributes, attribute, ATTRIBUTE_NAME_START);
  const nameEnd = attributeField(attributes, attribute, ATTRIBUTE_NAME_END);
  const valueStart = attributeField(attributes, attribute, ATTRIBUTE_VALUE_START);
  const valueEnd = attributeField(attributes, attribute, ATTRIBUTE_VALUE_END);
  if (valueStart === valueEnd || isNamespaceDeclaration(bytes, nameStart, nameEnd)) return;
  const localStart = localPartStart(bytes, nameStart, nameEnd);
  if (isNameIn(bytes, localStart, nameEnd, MACRO_ATTRIBUTES)) {
    throw unsafeFormula(UNSAFE_CONTENT_DETAILS.MACRO, entry, 'Workbook part assigns a macro');
  }
  const raw = bytes.subarray(valueStart, valueEnd);
  if (isNameIn(bytes, localStart, nameEnd, STYLES)) {
    assertSafeStyleAttribute(entry, raw);
    return;
  }
  // Excel data attributes are unqualified: a prefixed one keeps the broad rule.
  if (dataElement && localStart === nameStart) {
    assertDecodableAttribute(entry, raw);
  } else {
    assertNoCssUrl(entry, raw);
  }
  if (isUrlAttributeName(bytes, localStart, nameEnd)) {
    assertRelativeUrl(entry, raw, imageElement);
    return;
  }
  if (isNameIn(bytes, localStart, nameEnd, BASE_URL_ATTRIBUTES)) {
    assertRelativeUrl(entry, raw, false);
    return;
  }
  const field =
    isNameIn(bytes, localStart, nameEnd, FORMULA_ATTRIBUTES) ||
    (elementField !== null && isNameIn(bytes, localStart, nameEnd, elementField));
  if (!field) return;
  const quoted = isNameIn(bytes, localStart, nameEnd, PIVOT_FORMULA_ATTRIBUTE)
    ? formulaQuotes
    : 'sheet-name';
  assertSafeFormulaField(entry, raw, budget, quoted);
}

/** The field attribute of its own the element whose local name is bytes [start, end) carries, or null. */
function elementFormulaAttribute(bytes: Uint8Array, start: number, end: number): NameSet | null {
  for (const [element, attribute] of ELEMENT_FORMULA_ATTRIBUTES) {
    if (isNameIn(bytes, start, end, element)) return attribute;
  }
  return null;
}

/**
 * Refuses, UNSAFE_CONTENT `unsafe-part`, the tag scanned into `markup`, of an element
 * that is no hyperlink, when it names an external hyperlink of its part (see the
 * header): a prefixed attribute whose local name is `id` (ASCII case ignored, any
 * namespace) and whose value, read by attributeValueText, is one of `externalIds`.
 * CORRUPT_FILE `package-part` when such an attribute cannot be decoded.
 */
function assertNoExternalHyperlinkId(
  entry: string,
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  externalIds: ReadonlySet<string>,
): void {
  if (externalIds.size === 0) return;
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    const nameStart = attributeField(attributes, attribute, ATTRIBUTE_NAME_START);
    const nameEnd = attributeField(attributes, attribute, ATTRIBUTE_NAME_END);
    const localStart = localPartStart(bytes, nameStart, nameEnd);
    if (localStart === nameStart || !isNameIn(bytes, localStart, nameEnd, RELATIONSHIP_IDS)) {
      continue;
    }
    const id = attributeValueText(
      bytes.subarray(
        attributeField(attributes, attribute, ATTRIBUTE_VALUE_START),
        attributeField(attributes, attribute, ATTRIBUTE_VALUE_END),
      ),
    );
    if (id === null) throw undecodableAttribute(entry);
    if (externalIds.has(id)) {
      throw unsafePart(
        UNSAFE_CONTENT_DETAILS.HYPERLINK_REUSE,
        entry,
        'Workbook part names an external hyperlink from another element',
      );
    }
  }
}

/**
 * Refuses, UNSAFE_CONTENT `unsafe-part`, the tag scanned into `markup` of an element a
 * web renderer reads (see the header) when it is an SVG animation element, or when one
 * of its attributes, a namespace declaration aside, is an event handler (its ASCII-folded
 * local name starts with EVENT_HANDLER_PREFIX) or a WEB_RESOURCE_ATTRIBUTE_NAMES
 * attribute, whatever its value.
 */
function assertNoWebContent(
  entry: string,
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
): void {
  if (isNameIn(bytes, localNameStart(bytes, markup), markup.nameEnd, SVG_ANIMATION_ELEMENTS)) {
    throw unsafePart(
      UNSAFE_CONTENT_DETAILS.SVG_ANIMATION,
      entry,
      'Workbook part holds an SVG animation',
    );
  }
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    const nameStart = attributeField(attributes, attribute, ATTRIBUTE_NAME_START);
    const nameEnd = attributeField(attributes, attribute, ATTRIBUTE_NAME_END);
    if (isNamespaceDeclaration(bytes, nameStart, nameEnd)) continue;
    const localStart = localPartStart(bytes, nameStart, nameEnd);
    if (startsWithFolded(bytes, localStart, nameEnd, EVENT_HANDLER_PREFIX)) {
      throw unsafePart(
        UNSAFE_CONTENT_DETAILS.EVENT_HANDLER,
        entry,
        'Workbook part holds an event handler',
      );
    }
    if (isNameIn(bytes, localStart, nameEnd, WEB_RESOURCE_ATTRIBUTES)) {
      throw unsafePart(
        UNSAFE_CONTENT_DETAILS.WEB_RESOURCE,
        entry,
        'Workbook part holds an attribute that names a web resource',
      );
    }
  }
}

/** Whether the local name bytes [start, end) are one of IMAGE_ELEMENT_NAMES, compared exactly. */
function isImageElement(bytes: Uint8Array, start: number, end: number): boolean {
  return IMAGE_ELEMENT_NAMES.some((name) => bytesEqualAscii(bytes, start, end, name));
}

/**
 * Checks the start or empty tag scanned into `markup` with its `attributes` (see the
 * formula field header): no active element, no element but a hyperlink that names an
 * external hyperlink of this part (`hyperlinkIds`), every field attribute safe (a
 * hyperlink's `location` unless its relationship ids by `scopes` are only external
 * hyperlinks of this part), every attribute safe (assertSafeAttribute; an unprefixed
 * attribute of a `dataElement` skips the broad CSS rule), and, for a start tag of a
 * field element outside the OMML namespace (`scopes`), its content up to its own end
 * tag (left in `markup`; assertSafeFieldContent), empty for a macro element, white space
 * only for a script element. Every formula field is charged to `budget`.
 */
function assertSafeElement(
  entry: string,
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: number[],
  scopes: NamespaceScopes,
  hyperlinkIds: WorksheetHyperlinkIds,
  dataElement: boolean,
  budget: FormulaScanBudget,
): void {
  const localStart = localNameStart(bytes, markup);
  const localEnd = markup.nameEnd;
  if (isNameIn(bytes, localStart, localEnd, ACTIVE_ELEMENTS)) {
    throw unsafePart(
      UNSAFE_CONTENT_DETAILS.ACTIVE_ELEMENT,
      entry,
      'Workbook part holds an embedded object, a control, a frame, a script or a web publishing item',
    );
  }
  const hyperlink = isNameIn(bytes, localStart, localEnd, URL_FRAGMENT_ELEMENTS);
  if (!hyperlink) {
    assertNoExternalHyperlinkId(entry, bytes, markup, attributes, hyperlinkIds.external);
  }
  const urlFragment =
    hyperlink &&
    leadsToExternalHyperlink(scopes, bytes, markup, attributes, hyperlinkIds.onlyExternal);
  const elementField = urlFragment ? null : elementFormulaAttribute(bytes, localStart, localEnd);
  const formulaQuotes: QuotedSection = isNameIn(bytes, localStart, localEnd, PIVOT_FORMULA_ELEMENTS)
    ? 'field-name'
    : 'sheet-name';
  const imageElement = isImageElement(bytes, localStart, localEnd);
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    assertSafeAttribute(
      entry,
      bytes,
      attributes,
      attribute,
      elementField,
      formulaQuotes,
      imageElement,
      dataElement,
      budget,
    );
  }
  if (markup.kind !== 'start') return;
  const contentStart = markup.end;
  if (isNameIn(bytes, localStart, localEnd, MACRO_ELEMENTS)) {
    if (textOnlyContentEnd(entry, bytes, markup) !== contentStart) {
      throw unsafeFormula(UNSAFE_CONTENT_DETAILS.MACRO, entry, 'Workbook part assigns a macro');
    }
    return;
  }
  if (isNameIn(bytes, localStart, localEnd, SCRIPT_ELEMENTS)) {
    assertNoScript(entry, bytes, markup);
    return;
  }
  if (!isNameIn(bytes, localStart, localEnd, FORMULA_ELEMENTS)) return;
  if (elementNamespace(scopes, bytes, markup) === 'omml') return;
  assertSafeFieldContent(entry, bytes, markup, attributes, budget);
}

function createNamespaceScopes(): NamespaceScopes {
  return {
    bindings: new Map(),
    declaring: [],
    openNames: [],
    depth: 0,
    declarationsInScope: 0,
    broken: false,
  };
}

/**
 * The namespace the declaration value bytes [start, end) name (see NamespaceScopes):
 * OMML, relationships or an OFFICE_DATA_NAMESPACES namespace ('data') compared byte for
 * byte, 'scripted' when the decoded value is one of EVENT_HANDLER_NAMESPACES or cannot be
 * decoded.
 */
function knownNamespace(bytes: Uint8Array, start: number, end: number): KnownNamespace {
  for (const [uri, namespace] of KNOWN_NAMESPACES) {
    if (bytesEqualAscii(bytes, start, end, uri)) return namespace;
  }
  const uri = decodeXmlText(bytes.subarray(start, end));
  return uri === null || EVENT_HANDLER_NAMESPACES.includes(uri) ? 'scripted' : 'other';
}

/**
 * The namespace a prefix declared twice on one element names, by its `first` and
 * `second` declarations (see NamespaceScopes): the one both name (two Office data
 * namespaces name 'data'), 'scripted' when either does, else 'other'.
 */
function mergedNamespace(first: KnownNamespace, second: KnownNamespace): KnownNamespace {
  if (first === second) return first;
  return first === 'scripted' || second === 'scripted' ? 'scripted' : 'other';
}

/**
 * Counts the namespace declarations of the start or empty tag scanned into `markup` into
 * the declarations in scope, at most MAX_XMLNS_DECLARATIONS_PER_PART for part `entry`
 * (tooManyNamespaceDeclarations past it), and, while bindings count, binds them in
 * `scopes` at the current level. The prefixes it bound (to release with
 * releaseNamespaces), or null for none.
 */
function declareNamespaces(
  entry: string,
  scopes: NamespaceScopes,
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
): string[] | null {
  const level = scopes.depth;
  // Allocated at the first binding only: most elements declare none.
  let prefixes: string[] | null = null;
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    const nameStart = attributeField(attributes, attribute, ATTRIBUTE_NAME_START);
    const nameEnd = attributeField(attributes, attribute, ATTRIBUTE_NAME_END);
    if (!isNamespaceDeclaration(bytes, nameStart, nameEnd)) continue;
    scopes.declarationsInScope += 1;
    if (scopes.declarationsInScope > MAX_XMLNS_DECLARATIONS_PER_PART) {
      throw tooManyNamespaceDeclarations(entry);
    }
    if (scopes.broken) continue;
    const key =
      nameEnd === nameStart + NAMESPACE_DECLARATION.length
        ? DEFAULT_NAMESPACE_KEY
        : NAME_DECODER.decode(
            bytes.subarray(nameStart + NAMESPACE_DECLARATION_PREFIX.length, nameEnd),
          );
    const namespace = knownNamespace(
      bytes,
      attributeField(attributes, attribute, ATTRIBUTE_VALUE_START),
      attributeField(attributes, attribute, ATTRIBUTE_VALUE_END),
    );
    const stack = scopes.bindings.get(key) ?? [];
    scopes.bindings.set(key, stack);
    const innermost = stack.at(-1);
    // Only this element binds at this level: every element bound before at it is closed.
    if (innermost !== undefined && innermost.level === level) {
      innermost.namespace = mergedNamespace(innermost.namespace, namespace);
      continue;
    }
    stack.push({ level, namespace });
    prefixes ??= [];
    prefixes.push(key);
  }
  return prefixes;
}

/**
 * Removes the bindings of `prefixes`, the innermost of each, from `scopes`, and a prefix
 * whose last binding that was: only prefixes in scope stay held (see the header).
 */
function releaseNamespaces(scopes: NamespaceScopes, prefixes: readonly string[]): void {
  for (const key of prefixes) {
    const stack = scopes.bindings.get(key);
    if (stack === undefined) continue;
    stack.pop();
    if (stack.length === 0) scopes.bindings.delete(key);
  }
}

/**
 * Ends an element that never opens (an empty tag, or one read through its end tag),
 * which bound `prefixes` and held `declarations` namespace declarations: they leave
 * scope. Once the walk lost the nesting, declarations never leave scope.
 */
function endUnopenedElement(
  scopes: NamespaceScopes,
  prefixes: readonly string[] | null,
  declarations: number,
): void {
  if (scopes.broken) return;
  if (prefixes !== null) releaseNamespaces(scopes, prefixes);
  scopes.declarationsInScope -= declarations;
}

/**
 * Opens the element whose start tag names bytes [nameStart, nameEnd), which bound
 * `prefixes` and held `declarations` namespace declarations: its name on the stack of
 * open names, one level deeper, and an entry when it declared namespaces. Past
 * MAX_TRACKED_ELEMENT_DEPTH open elements, no binding counts from there on.
 */
function openElement(
  scopes: NamespaceScopes,
  nameStart: number,
  nameEnd: number,
  prefixes: readonly string[] | null,
  declarations: number,
): void {
  if (scopes.broken) return;
  if (scopes.depth === MAX_TRACKED_ELEMENT_DEPTH) {
    scopes.broken = true;
    return;
  }
  if (declarations > 0) {
    scopes.declaring.push({ level: scopes.depth, prefixes: prefixes ?? [], declarations });
  }
  scopes.openNames.push(nameStart, nameEnd);
  scopes.depth += 1;
}

/**
 * Closes the innermost open element with the end tag scanned into `markup`, which must
 * name it byte for byte, and releases the bindings and declarations of a declaring one.
 * An end tag that names another element, or one with no element open, leaves no binding
 * counting from there on.
 */
function closeElement(scopes: NamespaceScopes, bytes: Uint8Array, markup: XmlMarkup): void {
  if (scopes.broken) return;
  const nameEnd = scopes.openNames.pop();
  const nameStart = scopes.openNames.pop();
  if (
    nameStart === undefined ||
    nameEnd === undefined ||
    !closesElement(bytes, markup, nameStart, nameEnd)
  ) {
    scopes.broken = true;
    return;
  }
  scopes.depth -= 1;
  const innermost = scopes.declaring.at(-1);
  if (innermost === undefined || innermost.level !== scopes.depth) return;
  scopes.declaring.pop();
  releaseNamespaces(scopes, innermost.prefixes);
  scopes.declarationsInScope -= innermost.declarations;
}

/** The namespace the innermost binding of prefix `key` names in `scopes`, or null when none counts. */
function boundNamespace(scopes: NamespaceScopes, key: string): KnownNamespace | null {
  if (scopes.broken) return null;
  return scopes.bindings.get(key)?.at(-1)?.namespace ?? null;
}

/** The namespace the element scanned into `markup` is in by the bindings of `scopes`, or null when none counts. */
function elementNamespace(
  scopes: NamespaceScopes,
  bytes: Uint8Array,
  markup: XmlMarkup,
): KnownNamespace | null {
  const localStart = localNameStart(bytes, markup);
  const key =
    localStart === markup.nameStart
      ? DEFAULT_NAMESPACE_KEY
      : NAME_DECODER.decode(bytes.subarray(markup.nameStart, localStart - 1));
  return boundNamespace(scopes, key);
}

/**
 * Whether the tag scanned into `markup` leads to an external hyperlink of its part: it
 * has a relationship id (a non-empty attribute whose local name is exactly
 * RELATIONSHIP_ID_ATTRIBUTE and whose prefix is bound to RELATIONSHIPS_NAMESPACE by
 * `scopes`), and the value of every one it has, read by attributeValueText, is one of
 * `externalHyperlinkIds`.
 */
function leadsToExternalHyperlink(
  scopes: NamespaceScopes,
  bytes: Uint8Array,
  markup: XmlMarkup,
  attributes: readonly number[],
  externalHyperlinkIds: ReadonlySet<string>,
): boolean {
  if (externalHyperlinkIds.size === 0) return false;
  let found = false;
  for (let attribute = 0; attribute < markup.attributeCount; attribute += 1) {
    const nameStart = attributeField(attributes, attribute, ATTRIBUTE_NAME_START);
    const nameEnd = attributeField(attributes, attribute, ATTRIBUTE_NAME_END);
    const valueStart = attributeField(attributes, attribute, ATTRIBUTE_VALUE_START);
    const valueEnd = attributeField(attributes, attribute, ATTRIBUTE_VALUE_END);
    const localStart = localPartStart(bytes, nameStart, nameEnd);
    const candidate =
      localStart > nameStart &&
      valueStart !== valueEnd &&
      bytesEqualAscii(bytes, localStart, nameEnd, RELATIONSHIP_ID_ATTRIBUTE);
    if (!candidate) continue;
    const key = NAME_DECODER.decode(bytes.subarray(nameStart, localStart - 1));
    if (boundNamespace(scopes, key) !== 'relationships') continue;
    const id = attributeValueText(bytes.subarray(valueStart, valueEnd));
    if (id === null || !externalHyperlinkIds.has(id)) return false;
    found = true;
  }
  return found;
}

/** A byte inside a loose element name: anything above a space but `<`, `>`, `/`, `=` and quotes. */
function isLooseNameByte(byte: number | undefined): boolean {
  return (
    byte !== undefined &&
    byte > SPACE &&
    byte !== TAG_OPEN &&
    byte !== TAG_CLOSE &&
    byte !== SLASH &&
    byte !== EQUALS &&
    byte !== QUOTE &&
    byte !== APOSTROPHE
  );
}

/** Where the local part of the loose element name that starts at `nameStart` (right after a '<') starts: past its last ':'. */
function looseLocalStart(bytes: Uint8Array, nameStart: number): number {
  let localStart = nameStart;
  for (let at = nameStart; isLooseNameByte(bytes[at]); at += 1) {
    if (bytes[at] === COLON) localStart = at + 1;
  }
  return localStart;
}

/**
 * Whether any '<' of `bytes` opens an element whose loose local name (looseLocalStart:
 * the name a lenient reader takes, past its last ':') is `localName`, ASCII case
 * ignored. For a part the strict lexer cannot read. Linear: every loose name stops
 * before the next '<'.
 */
export function opensLooseElement(bytes: Uint8Array, localName: string): boolean {
  const names = nameSet([localName]);
  for (let at = nextMarkup(bytes, 0); at !== -1; at = nextMarkup(bytes, at + 1)) {
    const localStart = looseLocalStart(bytes, at + 1);
    let localEnd = localStart;
    while (isLooseNameByte(bytes[localEnd])) localEnd += 1;
    if (isNameIn(bytes, localStart, localEnd, names)) return true;
  }
  return false;
}

/** The end of the run of bytes the strict lexer takes into a name (ASCII letters, digits, '_', '-', '.') from `start`. */
function strictNameEnd(bytes: Uint8Array, start: number): number {
  let at = start;
  while (isNameByte(bytes[at])) at += 1;
  return at;
}

/**
 * After markup the strict lexer refuses at `from`, refuses the part when any '<' from
 * there on could open a field, macro, script, active or SVG animation element or an
 * element with a field attribute of its own (the strict-name head of its loose local
 * name, which a reader that stops at U+0080 or a non-ASCII letter reads, is one), any
 * run of name bytes is a field, macro, URL, base URL, style or web resource attribute
 * name or a stylesheet instruction target or starts with EVENT_HANDLER_PREFIX (an event
 * handler), ASCII case ignored, any '(' makes a call of `url(` or a
 * CSS_LOADING_FUNCTIONS function (every byte read by one CssNameRun, escapes decoded),
 * any `&#` opens a character reference (it could spell one), or, with `externalIds`
 * (the part's external hyperlinks), a run after a ':' is `id`. Linear: every loose name
 * stops before the next '<', every byte is read once more.
 */
function assertNoFieldAfter(
  entry: string,
  bytes: Uint8Array,
  from: number,
  externalIds: ReadonlySet<string>,
): void {
  for (let at = from; at !== -1; at = nextMarkup(bytes, at + 1)) {
    const localStart = looseLocalStart(bytes, at + 1);
    const headEnd = strictNameEnd(bytes, localStart);
    if (
      isNameIn(bytes, localStart, headEnd, ACTIVE_ELEMENTS) ||
      isNameIn(bytes, localStart, headEnd, SVG_ANIMATION_ELEMENTS)
    ) {
      throw unsafePart(
        UNSAFE_CONTENT_DETAILS.LOOSE_ACTIVE_ELEMENT,
        entry,
        'Workbook part holds an active element the strict lexer cannot read',
      );
    }
    if (
      isNameIn(bytes, localStart, headEnd, FORMULA_ELEMENTS) ||
      isNameIn(bytes, localStart, headEnd, FIELD_ATTRIBUTE_ELEMENTS) ||
      isNameIn(bytes, localStart, headEnd, MACRO_ELEMENTS) ||
      isNameIn(bytes, localStart, headEnd, SCRIPT_ELEMENTS)
    ) {
      throw unsafeFormula(
        UNSAFE_CONTENT_DETAILS.LOOSE_FORMULA,
        entry,
        'Workbook part holds a formula the strict lexer cannot read',
      );
    }
  }
  const cssName = createCssNameRun();
  let at = from;
  while (at < bytes.length) {
    const byte = bytes[at];
    if (byte === undefined) break;
    if (!isNameByte(byte)) {
      if (byte === AMPERSAND && bytes[at + 1] === HASH) {
        throw unsafePart(
          UNSAFE_CONTENT_DETAILS.LOOSE_REFERENCE,
          entry,
          'Workbook part holds a reference the strict lexer cannot read',
        );
      }
      if (readCssName(cssName, byte) !== 'none') {
        throw unsafePart(
          UNSAFE_CONTENT_DETAILS.LOOSE_CSS,
          entry,
          'Workbook part holds a CSS call the strict lexer cannot read',
        );
      }
      at += 1;
      continue;
    }
    const end = strictNameEnd(bytes, at);
    // No name byte is a '(': none of them ends a call.
    for (const nameByte of bytes.subarray(at, end)) readCssName(cssName, nameByte);
    if (
      isNameIn(bytes, at, end, FORMULA_ATTRIBUTES) ||
      isNameIn(bytes, at, end, MACRO_ATTRIBUTES)
    ) {
      throw unsafeFormula(
        UNSAFE_CONTENT_DETAILS.LOOSE_FORMULA,
        entry,
        'Workbook part holds a formula the strict lexer cannot read',
      );
    }
    const link =
      isUrlAttributeName(bytes, at, end) ||
      isNameIn(bytes, at, end, BASE_URL_ATTRIBUTES) ||
      isNameIn(bytes, at, end, STYLES) ||
      isNameIn(bytes, at, end, WEB_RESOURCE_ATTRIBUTES) ||
      isNameIn(bytes, at, end, STYLESHEET_INSTRUCTIONS) ||
      startsWithFolded(bytes, at, end, EVENT_HANDLER_PREFIX) ||
      (externalIds.size > 0 &&
        bytes[at - 1] === COLON &&
        isNameIn(bytes, at, end, RELATIONSHIP_IDS));
    if (link) {
      throw unsafePart(
        UNSAFE_CONTENT_DETAILS.LOOSE_LINK,
        entry,
        'Workbook part holds a link the strict lexer cannot read',
      );
    }
    at = end;
  }
}

/**
 * Whether the opaque markup scanned into `markup` (a comment, CDATA section or processing
 * instruction) holds SVG_TAG_OPEN, ASCII case ignored: web content to an HTML reader (see
 * the header).
 */
function opaqueHoldsSvgTag(bytes: Uint8Array, markup: XmlMarkup): boolean {
  const last = markup.end - SVG_TAG_OPEN.length;
  for (let at = markup.start + 1; at <= last; at += 1) {
    if (spellsFolded(bytes, at, SVG_TAG_OPEN)) return true;
  }
  return false;
}

/** Whether the opaque markup scanned into `markup` is a processing instruction that loads a resource. */
function isStylesheetInstruction(bytes: Uint8Array, markup: XmlMarkup): boolean {
  return (
    bytes[markup.start + 1] === QUESTION &&
    isNameIn(bytes, markup.nameStart, markup.nameEnd, STYLESHEET_INSTRUCTIONS)
  );
}

/** Feeds the character data bytes `raw`, decoded, to the CSS of `style`; UNSAFE_CONTENT `unsafe-part` when it cannot be decoded. */
function addStyleText(entry: string, style: StyleText, raw: Uint8Array): void {
  if (raw.length === 0) return;
  const text = decodeXmlText(raw);
  if (text === null) {
    throw unsafePart(
      UNSAFE_CONTENT_DETAILS.CSS_UNDECODABLE,
      entry,
      'Workbook part holds a style the scan cannot decode',
    );
  }
  feedCss(style.css, text);
}

/** Feeds the text of the CDATA section scanned into `markup`, if it is one, to the CSS of `style`. */
function addStyleCdata(bytes: Uint8Array, markup: XmlMarkup, style: StyleText): void {
  if (!bytesEqualAscii(bytes, markup.start, markup.start + CDATA_OPEN.length, CDATA_OPEN)) return;
  feedCss(
    style.css,
    FIELD_DECODER.decode(
      bytes.subarray(markup.start + CDATA_OPEN.length, markup.end - CDATA_CLOSE_LENGTH),
    ),
  );
}

/**
 * The CSS of the style element that ended (or of the rest of the part, when the walk
 * lost the nesting inside it) loads nothing (loadsCssResource), or UNSAFE_CONTENT
 * `unsafe-part`; then `style` leaves it.
 */
function endStyle(entry: string, style: StyleText): void {
  finishCss(style.css);
  if (style.css.loads) {
    throw unsafePart(
      UNSAFE_CONTENT_DETAILS.CSS_LOAD,
      entry,
      'Workbook part holds a style that loads a resource',
    );
  }
  style.level = OUTSIDE_STYLE;
  style.css = createCssScan(true);
}

/**
 * Throws SpreadsheetFileError UNSAFE_CONTENT `{ reason, detail, entry }` when XML part
 * `entry` holds a formula field that fails the scan, a macro assignment or a script
 * (`unsafe-formula`), an active element, an event handler or other web content, a URL
 * outside the package, CSS that loads a resource (a style, or any other attribute value
 * but an Excel data attribute: an unprefixed attribute of an element of an
 * OFFICE_DATA_NAMESPACES namespace read before the part's first web content and outside
 * a style element) or a stylesheet instruction (`unsafe-part`), or, past markup
 * the strict lexer refuses, anything that could be one (see the formula field header);
 * UNSAFE_CONTENT `{ detail, entry, cap }` when it holds more than
 * MAX_XMLNS_DECLARATIONS_PER_PART namespace declarations in scope at once;
 * CORRUPT_FILE `package-part` for an attribute
 * value it cannot decode. A hyperlink's `location` is a URL fragment
 * only with relationship ids that `hyperlinkIds` gives only an external hyperlink, and
 * no other element may name one it gives one. Every markup of the part is read, the
 * open elements and the namespace declarations in scope kept on the way, and the text
 * of a style element read piece by piece up to its end tag.
 */
function assertSafeFields(
  entry: string,
  bytes: Uint8Array,
  hyperlinkIds: WorksheetHyperlinkIds,
  budget: FormulaScanBudget,
): void {
  const markup = createMarkup();
  const attributes: number[] = [];
  const scopes = createNamespaceScopes();
  const style: StyleText = { level: OUTSIDE_STYLE, css: createCssScan(true) };
  // A top-level element of the part is `svg`: every element in it is web content.
  let svgPart = false;
  // The walk has read web content, an element named `svg` at any depth or opaque markup
  // that holds SVG_TAG_OPEN: no element from there on is a data element (see
  // assertSafeAttribute). Nor is an element inside
  // a style element of any namespace: a reader that takes the style's text raw reads
  // the element's attributes as CSS.
  let webSeen = false;
  let textStart = 0;
  for (let at = nextMarkup(bytes, 0); at !== -1; at = nextMarkup(bytes, markup.end)) {
    const inStyle = style.level !== OUTSIDE_STYLE;
    if (inStyle) addStyleText(entry, style, bytes.subarray(textStart, at));
    if (!lexes(bytes, at, markup, attributes)) {
      if (inStyle) {
        throw unsafePart(
          UNSAFE_CONTENT_DETAILS.LOOSE_STYLE,
          entry,
          'Workbook part holds a style the strict lexer cannot read',
        );
      }
      assertNoFieldAfter(entry, bytes, at, hyperlinkIds.external);
      return;
    }
    const kind = markup.kind;
    switch (kind) {
      case 'start':
      case 'empty': {
        const nameStart = markup.nameStart;
        const nameEnd = markup.nameEnd;
        const localStart = localNameStart(bytes, markup);
        const opensStyle = kind === 'start' && isNameIn(bytes, localStart, nameEnd, STYLES);
        svgPart ||=
          !scopes.broken && scopes.depth === 0 && isNameIn(bytes, localStart, nameEnd, SVG_ROOT);
        const inScopeBefore = scopes.declarationsInScope;
        const prefixes = declareNamespaces(entry, scopes, bytes, markup, attributes);
        const declarations = scopes.declarationsInScope - inScopeBefore;
        // Null when the walk lost the nesting or no binding names the element's prefix.
        const namespace = elementNamespace(scopes, bytes, markup);
        // A web renderer reads the element (see the header).
        const web = svgPart || scopes.broken || namespace === 'scripted';
        webSeen ||= web || isNameIn(bytes, localStart, nameEnd, SVG_ROOT);
        const dataElement = !webSeen && !inStyle && namespace === 'data';
        if (web) {
          assertNoWebContent(entry, bytes, markup, attributes);
        }
        assertSafeElement(
          entry,
          bytes,
          markup,
          attributes,
          scopes,
          hyperlinkIds,
          dataElement,
          budget,
        );
        // A field, macro or script element was read through its end tag, now in `markup`.
        if (markup.kind !== 'start') {
          endUnopenedElement(scopes, prefixes, declarations);
          break;
        }
        if (opensStyle && !inStyle) style.level = scopes.depth;
        openElement(scopes, nameStart, nameEnd, prefixes, declarations);
        break;
      }
      case 'end':
        closeElement(scopes, bytes, markup);
        if (inStyle && !scopes.broken && scopes.depth === style.level) endStyle(entry, style);
        break;
      case 'opaque':
        if (isStylesheetInstruction(bytes, markup)) {
          throw unsafePart(
            UNSAFE_CONTENT_DETAILS.STYLESHEET_INSTRUCTION,
            entry,
            'Workbook part holds a stylesheet instruction',
          );
        }
        webSeen ||= opaqueHoldsSvgTag(bytes, markup);
        if (inStyle) addStyleCdata(bytes, markup, style);
        break;
      default: {
        const _exhaustive: never = kind;
        throw new Error(`Unhandled markup kind: ${String(_exhaustive)}`);
      }
    }
    textStart = markup.end;
  }
  if (style.level === OUTSIDE_STYLE) return;
  addStyleText(entry, style, bytes.subarray(textStart));
  endStyle(entry, style);
}

/**
 * Rejects one XML part, whatever its name, that declares a DOCTYPE or ENTITY (any
 * case), references an entity other than the five predefined ones and numeric
 * character references, or holds an unsafe formula field, macro assignment, script,
 * active element, event handler or other web content, URL outside the package, CSS that
 * loads a resource or stylesheet instruction, or more than
 * MAX_XMLNS_DECLARATIONS_PER_PART namespace declarations in scope at once (see the
 * formula field header). A hyperlink's
 * `location` is taken for
 * a URL fragment only when its relationship ids are among those `hyperlinkIds` gives
 * only an external hyperlink, and no other element may name one it gives an external
 * hyperlink (those of this part, ExternalHyperlinkIds; none by default). Every formula
 * field is charged to `budget`, the upload's (a fresh one by default).
 * Throws SpreadsheetFileError('UNSAFE_CONTENT') naming `name` and the check that refused
 * it (`detail`, one of UNSAFE_CONTENT_DETAILS); a field refusal also carries its reason
 * (`unsafe-formula` or `unsafe-part`), the namespace refusal the cap.
 * An attribute value the scan cannot decode is CORRUPT_FILE `package-part`; formula
 * fields past the budget PAYLOAD_TOO_LARGE `formula-scan-budget`.
 */
export function assertSafeXmlPart(
  name: string,
  bytes: Uint8Array,
  hyperlinkIds: WorksheetHyperlinkIds = NO_HYPERLINK_IDS,
  budget: FormulaScanBudget = createFormulaScanBudget(),
): void {
  const xml = strFromU8(bytes);

  if (DTD_DECLARATION.test(xml)) {
    throw new SpreadsheetFileError('UNSAFE_CONTENT', 'Workbook part declares a DOCTYPE or ENTITY', {
      detail: UNSAFE_CONTENT_DETAILS.DOCTYPE,
      entry: name,
    });
  }
  if (UNKNOWN_ENTITY_REFERENCE.test(xml)) {
    throw new SpreadsheetFileError('UNSAFE_CONTENT', 'Workbook part references an unknown entity', {
      detail: UNSAFE_CONTENT_DETAILS.UNKNOWN_ENTITY,
      entry: name,
    });
  }
  assertSafeFields(name, bytes, hyperlinkIds, budget);
}

/**
 * Whether the first markup of a part, at the '<' at `at`, leaves the part in UTF-8: it
 * is not a processing instruction, or the strict lexer reads it and it is not an XML
 * declaration, or it is an XML declaration (target exactly `xml`) that names no encoding
 * but UTF-8. A processing instruction the lexer refuses, or whose target is `xml` only
 * in another ASCII case, is one another reader may take for a declaration: false.
 */
function keepsUtf8(bytes: Uint8Array, at: number): boolean {
  if (bytes[at + 1] !== QUESTION) return true;
  const markup = createMarkup();
  try {
    scanMarkup(bytes, at, markup);
    if (!hasDeclarationTarget(bytes, markup)) return true;
    return isXmlDeclaration(bytes, markup) && declaresUtf8(bytes, markup, []);
  } catch (error) {
    if (error instanceof XmlLexError) return false;
    throw error;
  }
}

/**
 * Throws SpreadsheetFileError CORRUPT_FILE `{ reason: 'part-encoding', entry }` unless
 * kept XML part `entry` is UTF-8 text (see the encoding header above): valid UTF-8, no
 * U+0000, and a first markup that keeps it in UTF-8 (keepsUtf8).
 */
export function assertUtf8Text(entry: string, bytes: Uint8Array): void {
  if (!isUtf8(bytes) || bytes.includes(NUL)) {
    throw partEncodingError(entry, 'is not UTF-8 text');
  }
  const first = nextMarkup(bytes, 0);
  if (first !== -1 && !keepsUtf8(bytes, first)) {
    throw partEncodingError(
      entry,
      'declares an encoding other than UTF-8, or a declaration the scan cannot read',
    );
  }
}

/**
 * Checks entries, given by name and content, by what they hold: each is sorted by its
 * first bytes (assertEntryContentKind: CORRUPT_FILE `part-encoding` for XML the scans
 * cannot read or a name that promises XML it does not hold), and each XML entry must
 * be UTF-8 text (assertUtf8Text: CORRUPT_FILE `part-encoding`) and pass
 * assertSafeXmlPart (UNSAFE_CONTENT), checked for its encoding first, with the external
 * hyperlink ids `externalHyperlinks` gives its name (none by default) and the upload's
 * formula scan `budget` (a fresh one by default). Every XML entry is checked, whatever
 * its name and whether a relationship names it or not: the export hands each of them on
 * unchanged. An entry `plan` gives to the package walk ('package-walk', contentScanPlan)
 * was content-scanned there: it is checked for its kind and its encoding only, so no
 * part is content-scanned twice (by default every entry is scanned here).
 */
export function assertSafeXmlContent(
  entries: Iterable<readonly [string, Uint8Array]>,
  externalHyperlinks: ExternalHyperlinkIds = NO_EXTERNAL_HYPERLINKS,
  budget: FormulaScanBudget = createFormulaScanBudget(),
  plan: ContentScanPlan = SCAN_EVERY_PART,
): void {
  for (const [name, bytes] of entries) {
    const kind = entryContentKind(bytes);
    assertEntryContentKind(name, kind);
    if (kind !== 'xml') continue;
    assertUtf8Text(name, bytes);
    if (plan.get(name) === 'package-walk') continue;
    assertSafeXmlPart(name, bytes, externalHyperlinks.get(name) ?? NO_HYPERLINK_IDS, budget);
  }
}
