// Package parts that declare a macro, an embedded object, an ActiveX control or an
// external link through a content type or a relationship type, all under harmless
// part names, and parts that only look like one. Shared by src/unsafe-parts.test.ts
// (the rule alone) and src/guards.test.ts (the same cases through the gate). Each case
// is a set of entries added to a one-sheet workbook, replacing a generated part of the
// same name.

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
const UTF7_DECLARATION = '<?xml version="1.0" encoding="UTF-7"?>';
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
const OFFICE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const STRICT_OFFICE_REL = 'http://purl.oclc.org/ooxml/officeDocument/relationships';
const MS_REL = 'http://schemas.microsoft.com/office/2006/relationships';
const MS_VBA_PROJECT_REL = `${MS_REL}/vbaProject`;
const RELS_CONTENT_TYPE = 'application/vnd.openxmlformats-package.relationships+xml';
const WORKBOOK_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml';
const MACRO_WORKBOOK_CONTENT_TYPE = 'application/vnd.ms-excel.sheet.macroEnabled.main+xml';
const SPREADSHEETML_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const VBA_PROJECT_DEFAULT =
  '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>';
const EXTERNAL_TARGET_MODE = ' TargetMode="External"';
// A file share an external relationship would load from.
const SHARE_TARGET = 'file://evil.example/share/a.png';
// The relationship types of an Office web add-in, its task pane, a custom ribbon
// (customUI, the 2006 and the 2007 type) and attached toolbars.
const MS_2011_REL = 'http://schemas.microsoft.com/office/2011/relationships';
const WEB_EXTENSION_REL = `${MS_2011_REL}/webextension`;
const WEB_EXTENSION_TASK_PANES_REL = `${MS_2011_REL}/webextensiontaskpanes`;
const CUSTOM_UI_2006_REL = `${MS_REL}/ui/extensibility`;
const CUSTOM_UI_2007_REL =
  'http://schemas.microsoft.com/office/2007/relationships/ui/extensibility';
const ATTACHED_TOOLBARS_REL = `${MS_REL}/attachedToolbars`;
const HYPERLINK_REL = `${OFFICE_REL}/hyperlink`;
const IMAGE_REL = `${OFFICE_REL}/image`;
const OFFICE_DOCUMENT_RELATIONSHIP = `<Relationship Id="rId1" Type="${OFFICE_REL}/officeDocument" Target="xl/workbook.xml"/>`;
// The web address an external hyperlink of a worksheet may have.
const WEB_TARGET = 'https://example.com/a';
const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const WEB_IMAGE_NS = 'http://schemas.microsoft.com/office/spreadsheetml/2020/richdatawebimage';
// A rich-data web image part: its address is a relationship of its own rels part.
const WEB_IMAGE_XML = `${XML_DECLARATION}<webImagesSrd xmlns="${WEB_IMAGE_NS}" xmlns:r="${OFFICE_REL}"><webImageSrd><address r:id="rId9"/></webImageSrd></webImagesSrd>`;

export const CONTENT_TYPES_PART = '[Content_Types].xml';
export const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';
/** The worksheet part of the one-sheet workbook, and a worksheet to put there or elsewhere. */
export const SHEET_PART = 'xl/worksheets/sheet1.xml';
export const WORKSHEET_XML = `${XML_DECLARATION}<worksheet xmlns="${SPREADSHEET_NS}"><sheetData/></worksheet>`;
const ROOT_RELS_PART = '_rels/.rels';
const SHEET_RELS_PART = 'xl/worksheets/_rels/sheet1.xml.rels';
const DRAWING_RELS_PART = 'xl/drawings/_rels/drawing1.xml.rels';
const TASK_PANES_RELS_PART = 'xl/webextensions/_rels/taskpanes.xml.rels';
const WEB_IMAGE_RELS_PART = 'xl/richData/_rels/rdRichValueWebImage.xml.rels';
const CHART_SHEET_RELS_PART = 'xl/chartsheets/_rels/sheet1.xml.rels';
// Where the cases put a part whose name says nothing about what it is.
const MOVED_PART = 'xl/x/a.xml';
// Relationships parts of parts that are not named .xml: a chart stored as .bin, a VML
// drawing, a workbook-level part, and a worksheet stored as .bin.
const BIN_CHART_RELS_PART = 'xl/charts/_rels/chart1.bin.rels';
const VML_DRAWING_RELS_PART = 'xl/drawings/_rels/vmlDrawing1.vml.rels';
const VBA_DATA_RELS_PART = 'xl/_rels/vbaData.rels';
const BIN_SHEET_RELS_PART = 'xl/worksheets/_rels/s2.bin.rels';

export interface PackagePartCase {
  readonly label: string;
  readonly entries: Readonly<Record<string, string>>;
}

/** One Relationship element; `attributes` follow the Target as they are. */
function relationship(type: string, target: string, attributes = ''): string {
  return `<Relationship Id="rId9" Type="${type}" Target="${target}"${attributes}/>`;
}

/** A relationships part holding `relationships` (Relationship elements) in order. */
function relationshipsXml(...relationships: readonly string[]): string {
  return `${XML_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NS}">${relationships.join('')}</Relationships>`;
}

/** `xml` as a UTF-7 encoder may write its ASCII markup: '<', '>' and '"' shifted to base64. */
export function utf7Markup(xml: string): string {
  return xml.replaceAll('<', '+ADw-').replaceAll('>', '+AD4-').replaceAll('"', '+ACI-');
}

/** The content types part buildXlsxFixture writes for one sheet, the workbook typed `workbookType`, plus `children`. */
export function contentTypesXml(workbookType = WORKBOOK_CONTENT_TYPE, children = ''): string {
  return (
    `${XML_DECLARATION}<Types xmlns="${CONTENT_TYPES_NS}">` +
    `<Default Extension="rels" ContentType="${RELS_CONTENT_TYPE}"/>` +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    `<Override PartName="/xl/workbook.xml" ContentType="${workbookType}"/>` +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    `${children}</Types>`
  );
}

const SHEET_RELATIONSHIP =
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>';

/** The workbook rels with the sheet relationship and `more`. */
export function workbookRels(...more: readonly string[]): string {
  return relationshipsXml(SHEET_RELATIONSHIP, ...more);
}

/** The workbook rels naming the moved part with a relationship of `type`, and the part. */
function workbookRelationship(type: string): Readonly<Record<string, string>> {
  return {
    [WORKBOOK_RELS_PART]: workbookRels(relationship(type, 'x/a.xml')),
    [MOVED_PART]: '<a/>',
  };
}

/** A sheet rels part holding one relationship of `type` to `target`. */
function sheetRelationship(
  type: string,
  attributes = '',
  target = '../x/a.xml',
): Readonly<Record<string, string>> {
  return { [SHEET_RELS_PART]: relationshipsXml(relationship(type, target, attributes)) };
}

/** Root relationships naming the workbook and, with a relationship of `type`, a part. */
function rootRelationship(type: string): Readonly<Record<string, string>> {
  return {
    [ROOT_RELS_PART]: relationshipsXml(OFFICE_DOCUMENT_RELATIONSHIP, relationship(type, 'x/a.xml')),
  };
}

/** A drawing rels part holding one image relationship to `target`, with `attributes`. */
function drawingImage(target: string, attributes = ''): Readonly<Record<string, string>> {
  return { [DRAWING_RELS_PART]: relationshipsXml(relationship(IMAGE_REL, target, attributes)) };
}

function contentTypes(workbookType: string, children = ''): Readonly<Record<string, string>> {
  return { [CONTENT_TYPES_PART]: contentTypesXml(workbookType, children) };
}

function override(contentType: string): string {
  return `<Override PartName="/${MOVED_PART}" ContentType="${contentType}"/>`;
}

/** Refused with UNSAFE_CONTENT `unsafe-part`. */
export const UNSAFE_PART_CASES: readonly PackagePartCase[] = [
  {
    label: 'an external link part moved to xl/x/a.xml, named by its relationship type',
    entries: workbookRelationship(`${OFFICE_REL}/externalLink`),
  },
  {
    label: 'the same with the strict-namespace relationship type',
    entries: workbookRelationship(`${STRICT_OFFICE_REL}/externalLink`),
  },
  {
    label: 'the same with the last segment in upper case',
    entries: workbookRelationship(`${OFFICE_REL}/EXTERNALLINK`),
  },
  {
    label: 'a sheet relationship of type oleObject',
    entries: sheetRelationship(`${OFFICE_REL}/oleObject`),
  },
  {
    label: 'a sheet relationship of type package',
    entries: sheetRelationship(`${OFFICE_REL}/package`),
  },
  {
    label: 'a sheet relationship of type control',
    entries: sheetRelationship(`${OFFICE_REL}/control`),
  },
  {
    label: 'a workbook relationship of type xlMacrosheet',
    entries: workbookRelationship(`${OFFICE_REL}/xlMacrosheet`),
  },
  {
    label: 'a workbook relationship of type dialogsheet',
    entries: workbookRelationship(`${OFFICE_REL}/dialogsheet`),
  },
  {
    label: 'a workbook relationship of the Microsoft vbaProject type',
    entries: workbookRelationship(MS_VBA_PROJECT_REL),
  },
  {
    label: 'a Default content type of a vbaProject',
    entries: contentTypes(
      WORKBOOK_CONTENT_TYPE,
      '<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>',
    ),
  },
  {
    label: 'a macro-enabled workbook Override',
    entries: contentTypes(MACRO_WORKBOOK_CONTENT_TYPE),
  },
  {
    label: 'an Override of an external link content type',
    entries: contentTypes(
      WORKBOOK_CONTENT_TYPE,
      override('application/vnd.openxmlformats-officedocument.spreadsheetml.externalLink+xml'),
    ),
  },
  {
    label: 'an Override of an oleObject content type',
    entries: contentTypes(
      WORKBOOK_CONTENT_TYPE,
      override('application/vnd.openxmlformats-officedocument.oleObject'),
    ),
  },
  {
    label: 'an Override of an activeX content type',
    entries: contentTypes(WORKBOOK_CONTENT_TYPE, override('application/vnd.ms-office.activeX+xml')),
  },
  {
    label: 'a workbook relationship of the Microsoft xlIntlMacrosheet type',
    entries: workbookRelationship(`${MS_REL}/xlIntlMacrosheet`),
  },
  {
    label: 'an Override of an international macro sheet content type',
    entries: contentTypes(
      WORKBOOK_CONTENT_TYPE,
      override('application/vnd.ms-excel.intlmacrosheet+xml'),
    ),
  },
  {
    label: 'an Override of a macro sheet content type',
    entries: contentTypes(
      WORKBOOK_CONTENT_TYPE,
      override('application/vnd.ms-excel.macrosheet+xml'),
    ),
  },
  {
    label: 'an Override of a dialog sheet content type',
    entries: contentTypes(
      WORKBOOK_CONTENT_TYPE,
      override(`${SPREADSHEETML_CONTENT_TYPE}.dialogsheet+xml`),
    ),
  },
  {
    label: 'a workbook relationship of type connections',
    entries: workbookRelationship(`${OFFICE_REL}/connections`),
  },
  {
    label: 'a sheet relationship of type queryTable',
    entries: sheetRelationship(`${OFFICE_REL}/queryTable`),
  },
  {
    label: 'an Override of the data connections content type',
    entries: contentTypes(
      WORKBOOK_CONTENT_TYPE,
      override(`${SPREADSHEETML_CONTENT_TYPE}.connections+xml`),
    ),
  },
  {
    label: 'an Override of a query table content type',
    entries: contentTypes(
      WORKBOOK_CONTENT_TYPE,
      override(`${SPREADSHEETML_CONTENT_TYPE}.queryTable+xml`),
    ),
  },
  {
    label: 'a drawing image relationship to a file share with TargetMode="External"',
    entries: {
      [DRAWING_RELS_PART]: relationshipsXml(
        relationship(`${OFFICE_REL}/image`, SHARE_TARGET, EXTERNAL_TARGET_MODE),
      ),
    },
  },
  {
    label: 'an image relationship with TargetMode="external" in lower case',
    entries: {
      [DRAWING_RELS_PART]: relationshipsXml(
        relationship(`${OFFICE_REL}/image`, SHARE_TARGET, ' TargetMode="external"'),
      ),
    },
  },
  {
    label: 'a relationship without a Type with TargetMode="External"',
    entries: {
      [SHEET_RELS_PART]: relationshipsXml(
        `<Relationship Id="rId9" Target="${SHARE_TARGET}"${EXTERNAL_TARGET_MODE}/>`,
      ),
    },
  },
  {
    label: 'a hyperlink type followed by a space with TargetMode="External"',
    entries: sheetRelationship(`${OFFICE_REL}/hyperlink `, EXTERNAL_TARGET_MODE),
  },
  {
    label: 'a package relationship in the rels of a chart stored as .bin',
    entries: {
      [BIN_CHART_RELS_PART]: relationshipsXml(relationship(`${OFFICE_REL}/package`, '../x/y.xlsx')),
    },
  },
  {
    label: 'an external oleObject and an externalLink in the rels of a VML drawing',
    entries: {
      [VML_DRAWING_RELS_PART]: relationshipsXml(
        relationship(`${OFFICE_REL}/oleObject`, SHARE_TARGET, EXTERNAL_TARGET_MODE),
        relationship(`${OFFICE_REL}/externalLink`, '../x/e.xml'),
      ),
    },
  },
  {
    label: 'a vbaProject relationship in xl/_rels/vbaData.rels',
    entries: { [VBA_DATA_RELS_PART]: relationshipsXml(relationship(MS_VBA_PROJECT_REL, 'm.bin')) },
  },
  {
    label: 'a control relationship in the rels of a worksheet stored as .bin',
    entries: {
      [BIN_SHEET_RELS_PART]: relationshipsXml(relationship(`${OFFICE_REL}/control`, '../x/ax.xml')),
    },
  },
  {
    label: 'an Office add-in task pane named by the root relationships',
    entries: rootRelationship(WEB_EXTENSION_TASK_PANES_REL),
  },
  {
    label: 'a web add-in relationship in the rels of its task pane part',
    entries: {
      [TASK_PANES_RELS_PART]: relationshipsXml(
        relationship(WEB_EXTENSION_REL, 'webextension1.xml'),
      ),
    },
  },
  {
    label: 'an Override of the web add-in content type',
    entries: contentTypes(
      WORKBOOK_CONTENT_TYPE,
      override('application/vnd.ms-office.webextension+xml'),
    ),
  },
  {
    label: 'an Override of the web add-in task pane content type',
    entries: contentTypes(
      WORKBOOK_CONTENT_TYPE,
      override('application/vnd.ms-office.webextensiontaskpanes+xml'),
    ),
  },
  {
    label: 'a custom ribbon of the 2007 customUI type named by the root relationships',
    entries: rootRelationship(CUSTOM_UI_2007_REL),
  },
  {
    label: 'a custom ribbon of the 2006 customUI type named by the root relationships',
    entries: rootRelationship(CUSTOM_UI_2006_REL),
  },
  {
    label: 'an Override of a customUI content type',
    entries: contentTypes(
      WORKBOOK_CONTENT_TYPE,
      override('application/vnd.ms-office.customUI+xml'),
    ),
  },
  {
    label: 'attached toolbars named by the workbook rels',
    entries: workbookRelationship(ATTACHED_TOOLBARS_REL),
  },
  {
    label: 'XML maps named by the workbook rels',
    entries: workbookRelationship(`${OFFICE_REL}/xmlMaps`),
  },
  {
    label: 'an Override whose content type names XML maps',
    entries: contentTypes(
      WORKBOOK_CONTENT_TYPE,
      override(`${SPREADSHEETML_CONTENT_TYPE}.xmlMaps+xml`),
    ),
  },
  {
    label:
      'an external https hyperlink in the rels of a rich-data web image moved into xl/worksheets',
    entries: {
      'xl/worksheets/rdRichValueWebImage.xml': WEB_IMAGE_XML,
      'xl/worksheets/_rels/rdRichValueWebImage.xml.rels': relationshipsXml(
        relationship(HYPERLINK_REL, 'https://evil.example/pixel.png', EXTERNAL_TARGET_MODE),
      ),
    },
  },
  {
    label: 'an external https hyperlink in worksheet rels whose worksheet the package lacks',
    entries: {
      'xl/worksheets/_rels/sheet9.xml.rels': relationshipsXml(
        relationship(HYPERLINK_REL, WEB_TARGET, EXTERNAL_TARGET_MODE),
      ),
    },
  },
  {
    label: 'an external https hyperlink of a worksheet another entry names in another ASCII case',
    entries: {
      'xl/worksheets/SHEET1.xml': WEB_IMAGE_XML,
      [SHEET_RELS_PART]: relationshipsXml(
        relationship(HYPERLINK_REL, WEB_TARGET, EXTERNAL_TARGET_MODE),
      ),
    },
  },
  ...[
    'file://evil.example/share/x.xlsx',
    '\\\\evil.example\\share\\payload.exe',
    'ms-excel:ofe|u|https://evil.example/x.xlsm',
    'search-ms:query=x&amp;crumb=location:\\\\evil.example\\s',
    'javascript:alert(1)',
    ` ${WEB_TARGET}`,
  ].map(
    (target): PackagePartCase => ({
      label: `an external worksheet hyperlink to ${target}`,
      entries: sheetRelationship(HYPERLINK_REL, EXTERNAL_TARGET_MODE, target),
    }),
  ),
  {
    label: 'an external https hyperlink in the rels of a drawing (a picture hlinkClick)',
    entries: {
      [DRAWING_RELS_PART]: relationshipsXml(
        relationship(HYPERLINK_REL, WEB_TARGET, EXTERNAL_TARGET_MODE),
      ),
    },
  },
  {
    label: 'an external hyperlink to a file share in the rels of a drawing (a blip r:link)',
    entries: {
      [DRAWING_RELS_PART]: relationshipsXml(
        relationship(HYPERLINK_REL, '\\\\evil.example\\s\\pixel.png', EXTERNAL_TARGET_MODE),
      ),
    },
  },
  {
    label: 'an external https hyperlink in the rels of a rich-data web image',
    entries: {
      [WEB_IMAGE_RELS_PART]: relationshipsXml(
        relationship(HYPERLINK_REL, 'https://evil.example/pixel.png', EXTERNAL_TARGET_MODE),
      ),
    },
  },
  {
    label: 'an external https hyperlink in the rels of a chart sheet',
    entries: {
      [CHART_SHEET_RELS_PART]: relationshipsXml(
        relationship(HYPERLINK_REL, WEB_TARGET, EXTERNAL_TARGET_MODE),
      ),
    },
  },
  ...[
    'http://evil.example/track.png',
    'https://evil.example/track.png',
    'file://///evil.example/s/p.png',
    '\\\\evil.example\\s\\x.png',
    '//evil.example/s/x.png',
    'C:x.png',
    'C:\\Users\\Public\\x.png',
    '..\\media\\image1.png',
    'ms-excel:ofe|u|x',
    ' http://evil.example/x.png',
    'http&#58;//evil.example/x.png',
    'ht&#9;tp://evil.example/x.png',
    'http&#10;://evil.example/x.png',
    'f&#13;ile://evil.example/s/x.png',
    '/&#9;/evil.example/s/x.png',
    'C|/Users/Public/x.png',
  ].map(
    (target): PackagePartCase => ({
      label: `an internal image Target ${target}`,
      entries: drawingImage(target),
    }),
  ),
  {
    label: 'an image relationship with TargetMode="Internal" to a web address',
    entries: drawingImage('https://evil.example/x.png', ' TargetMode="Internal"'),
  },
];

/** Refused with CORRUPT_FILE `package-part`. */
export const PACKAGE_PART_CASES: readonly PackagePartCase[] = [
  {
    label: 'a relationship Type written with a character reference',
    entries: sheetRelationship(`${OFFICE_REL}/externalLin&#107;`),
  },
  {
    label: 'a rels part with an unquoted attribute',
    entries: {
      [SHEET_RELS_PART]: relationshipsXml(
        `<Relationship Id=rId1 Type="${OFFICE_REL}/image" Target="../media/image1.png"/>`,
      ),
    },
  },
  {
    label: 'an entry named xl/worksheets/_rels/sheet1.xml.RELS',
    entries: { 'xl/worksheets/_rels/sheet1.xml.RELS': relationshipsXml() },
  },
  {
    label: 'an entry named xl/worksheets/_rels/sheet1.XML.rels',
    entries: { 'xl/worksheets/_rels/sheet1.XML.rels': relationshipsXml() },
  },
  {
    label: 'a second content types part spelled [content_types].xml',
    entries: { '[content_types].xml': contentTypesXml() },
  },
  {
    label: 'a TargetMode written with a character reference',
    entries: sheetRelationship(`${OFFICE_REL}/image`, ' TargetMode="Ext&#101;rnal"'),
  },
  {
    label: 'content types holding only the XML declaration',
    entries: { [CONTENT_TYPES_PART]: XML_DECLARATION },
  },
  {
    label: 'a sheet rels part holding only the XML declaration',
    entries: { [SHEET_RELS_PART]: XML_DECLARATION },
  },
  {
    label: 'UTF-7 content types hiding a vbaProject Default',
    entries: {
      [CONTENT_TYPES_PART]: contentTypesXml(
        WORKBOOK_CONTENT_TYPE,
        utf7Markup(VBA_PROJECT_DEFAULT),
      ).replace(XML_DECLARATION, UTF7_DECLARATION),
    },
  },
  {
    label: 'UTF-7 workbook rels hiding an external link relationship',
    entries: {
      [WORKBOOK_RELS_PART]: workbookRels(
        utf7Markup(relationship(`${OFFICE_REL}/externalLink`, 'x/a.xml')),
      ).replace(XML_DECLARATION, UTF7_DECLARATION),
      [MOVED_PART]: '<a/>',
    },
  },
  {
    label: 'a vbaProject Default below a direct child of the content types root',
    entries: {
      [CONTENT_TYPES_PART]: contentTypesXml(WORKBOOK_CONTENT_TYPE, `<W>${VBA_PROJECT_DEFAULT}</W>`),
    },
  },
  {
    label: 'an oleObject relationship below a direct child of a sheet rels root',
    entries: {
      [SHEET_RELS_PART]: relationshipsXml(
        `<W>${relationship(`${OFFICE_REL}/oleObject`, '../x/a.bin')}</W>`,
      ),
    },
  },
  {
    label: 'a Target holding a character reference past U+10FFFF',
    entries: drawingImage('../media/image&#1114112;.png'),
  },
  {
    label: 'a Relationship with two Target attributes',
    entries: {
      [DRAWING_RELS_PART]: relationshipsXml(
        `<Relationship Id="rId9" Type="${IMAGE_REL}" Target="../media/a.png" Target="http://evil.example/a.png"/>`,
      ),
    },
  },
];

/** Accepted. */
export const SAFE_PART_CASES: readonly PackagePartCase[] = [
  {
    label: 'a hyperlink relationship with TargetMode="External"',
    entries: {
      [SHEET_RELS_PART]: relationshipsXml(
        relationship(
          `${OFFICE_REL}/hyperlink`,
          'https://example.com/a?b=1&amp;c=2',
          ' TargetMode="External"',
        ),
      ),
    },
  },
  {
    label: 'a relationship type whose last segment only starts with package',
    entries: sheetRelationship(`${OFFICE_REL}/packageOther`),
  },
  {
    label: 'a drawing relationship and an image relationship',
    entries: {
      [SHEET_RELS_PART]: relationshipsXml(
        relationship(`${OFFICE_REL}/drawing`, '../drawings/drawing1.xml'),
      ),
      [DRAWING_RELS_PART]: relationshipsXml(
        relationship(`${OFFICE_REL}/image`, '../media/image1.png'),
      ),
    },
  },
  {
    label: 'the relationships content type, which holds "package"',
    entries: contentTypes(WORKBOOK_CONTENT_TYPE),
  },
  {
    label: 'a hyperlink relationship whose type ends in HYPERLINK with TargetMode="External"',
    entries: sheetRelationship(`${OFFICE_REL}/HYPERLINK`, EXTERNAL_TARGET_MODE, WEB_TARGET),
  },
  {
    label: 'an image relationship with TargetMode="Internal"',
    entries: {
      [DRAWING_RELS_PART]: relationshipsXml(
        relationship(`${OFFICE_REL}/image`, '../media/image1.png', ' TargetMode="Internal"'),
      ),
    },
  },
  {
    label: 'an image relationship in the rels of a chart stored as .bin',
    entries: {
      [BIN_CHART_RELS_PART]: relationshipsXml(
        relationship(`${OFFICE_REL}/image`, '../media/image1.png'),
      ),
    },
  },
  {
    label: 'a relationships part that declares utf-8 in lower case',
    entries: {
      [SHEET_RELS_PART]: relationshipsXml(
        relationship(`${OFFICE_REL}/image`, '../media/image1.png'),
      ).replace('UTF-8', 'utf-8'),
    },
  },
  {
    label: 'external worksheet hyperlinks to http, https and mailto addresses, in any ASCII case',
    entries: {
      [SHEET_RELS_PART]: relationshipsXml(
        relationship(HYPERLINK_REL, 'http://example.com/a', EXTERNAL_TARGET_MODE),
        relationship(HYPERLINK_REL, 'HTTPS://EXAMPLE.COM/B', EXTERNAL_TARGET_MODE),
        relationship(HYPERLINK_REL, 'mailto:seller@example.com', EXTERNAL_TARGET_MODE),
      ),
    },
  },
  {
    label: 'an internal image Target from the package root',
    entries: drawingImage('/xl/media/image1.png'),
  },
  {
    label: 'an internal image Target holding a colon after a path segment',
    entries: drawingImage('../media/a:b.png'),
  },
  {
    label: 'an external https hyperlink of a worksheet stored outside xl/worksheets',
    entries: {
      'xl/x/s.xml': WORKSHEET_XML,
      'xl/x/_rels/s.xml.rels': relationshipsXml(
        relationship(HYPERLINK_REL, WEB_TARGET, EXTERNAL_TARGET_MODE),
      ),
    },
  },
];
