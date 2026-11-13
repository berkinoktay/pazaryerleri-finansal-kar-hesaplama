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

export const CONTENT_TYPES_PART = '[Content_Types].xml';
export const WORKBOOK_RELS_PART = 'xl/_rels/workbook.xml.rels';
const SHEET_RELS_PART = 'xl/worksheets/_rels/sheet1.xml.rels';
const DRAWING_RELS_PART = 'xl/drawings/_rels/drawing1.xml.rels';
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

/** A sheet rels part holding one relationship of `type`. */
function sheetRelationship(type: string, attributes = ''): Readonly<Record<string, string>> {
  return { [SHEET_RELS_PART]: relationshipsXml(relationship(type, '../x/a.xml', attributes)) };
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
    entries: sheetRelationship(`${OFFICE_REL}/HYPERLINK`, EXTERNAL_TARGET_MODE),
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
];
