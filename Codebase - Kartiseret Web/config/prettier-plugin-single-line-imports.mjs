import * as prettier from "prettier";
import * as prettierPluginBabel from "prettier/plugins/babel";
import * as prettierPluginTypeScript from "prettier/plugins/typescript";
import * as prettierPluginEstree from "prettier/plugins/estree";

const { group } = prettier.doc.builders;
const basePrinter = prettierPluginEstree.printers.estree;

function hasComments(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }

  seen.add(value);

  if (
    (Array.isArray(value.comments) && value.comments.length > 0) ||
    (Array.isArray(value.leadingComments) &&
      value.leadingComments.length > 0) ||
    (Array.isArray(value.trailingComments) &&
      value.trailingComments.length > 0) ||
    (Array.isArray(value.innerComments) && value.innerComments.length > 0)
  ) {
    return true;
  }

  for (const key of Object.keys(value)) {
    if (hasComments(value[key], seen)) {
      return true;
    }
  }

  return false;
}

function quoteString(text, options) {
  const quote = options.singleQuote ? "'" : '"';
  return prettier.util.makeString(text, quote, true);
}

function renderImportKindPrefix(kind) {
  if (!kind || kind === "value") {
    return "";
  }

  if (kind === "type" || kind === "typeof") {
    return `${kind} `;
  }

  return null;
}

function renderModuleExportName(node, options) {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (typeof node.name === "string") {
    return {
      bindingName: node.name,
      printed: node.name,
      isStringLiteral: false,
    };
  }

  if (typeof node.value === "string") {
    return {
      bindingName: node.value,
      printed: quoteString(node.value, options),
      isStringLiteral: true,
    };
  }

  return null;
}

function renderImportAttributePart(node, options) {
  const name = renderModuleExportName(node, options);

  if (name) {
    return name.printed;
  }

  return null;
}

function renderLiteral(node, options) {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (typeof node.value === "string") {
    return quoteString(node.value, options);
  }

  if (
    typeof node.value === "number" ||
    typeof node.value === "boolean" ||
    node.value === null
  ) {
    return String(node.value);
  }

  if (node.type === "Identifier" && typeof node.name === "string") {
    return node.name;
  }

  if (typeof node.raw === "string") {
    return node.raw;
  }

  return null;
}

function renderImportAttribute(attribute, options) {
  const key = renderImportAttributePart(attribute?.key, options);
  const value = renderLiteral(attribute?.value, options);

  if (!key || value === null) {
    return null;
  }

  return `${key}: ${value}`;
}

function renderImportAttributes(node, options) {
  const attributes = Array.isArray(node.attributes) ? node.attributes : [];
  const assertions = Array.isArray(node.assertions) ? node.assertions : [];

  if (attributes.length > 0 && assertions.length > 0) {
    return null;
  }

  const entries = attributes.length > 0 ? attributes : assertions;

  if (entries.length === 0) {
    return "";
  }

  const keyword = attributes.length > 0 ? " with " : " assert ";
  const rendered = [];

  for (const entry of entries) {
    const part = renderImportAttribute(entry, options);

    if (!part) {
      return null;
    }

    rendered.push(part);
  }

  return `${keyword}{ ${rendered.join(", ")} }`;
}

function renderImportSpecifiers(specifiers, options) {
  let defaultPart = "";
  let namespacePart = "";
  const namedParts = [];

  for (const specifier of specifiers) {
    switch (specifier.type) {
      case "ImportDefaultSpecifier": {
        if (defaultPart) {
          return null;
        }

        if (!specifier.local?.name) {
          return null;
        }

        defaultPart = specifier.local.name;
        break;
      }

      case "ImportNamespaceSpecifier": {
        if (namespacePart || namedParts.length > 0 || !specifier.local?.name) {
          return null;
        }

        namespacePart = `* as ${specifier.local.name}`;
        break;
      }

      case "ImportSpecifier": {
        if (namespacePart || !specifier.local?.name) {
          return null;
        }

        const imported = renderModuleExportName(specifier.imported, options);
        const kindPrefix = renderImportKindPrefix(specifier.importKind);

        if (!imported || kindPrefix === null) {
          return null;
        }

        const aliasNeeded =
          imported.isStringLiteral ||
          specifier.local.name !== imported.bindingName;
        const alias = aliasNeeded ? ` as ${specifier.local.name}` : "";

        namedParts.push(`${kindPrefix}${imported.printed}${alias}`);
        break;
      }

      default:
        return null;
    }
  }

  const parts = [];

  if (defaultPart) {
    parts.push(defaultPart);
  }

  if (namespacePart) {
    parts.push(namespacePart);
  }

  if (namedParts.length > 0) {
    parts.push(`{ ${namedParts.join(", ")} }`);
  }

  return parts.join(", ");
}

function renderSingleLineImport(node, options) {
  if (node.type !== "ImportDeclaration") {
    return null;
  }

  if (hasComments(node) || node.phase) {
    return null;
  }

  if (!node.source || typeof node.source.value !== "string") {
    return null;
  }

  const declarationKindPrefix = renderImportKindPrefix(node.importKind);

  if (declarationKindPrefix === null) {
    return null;
  }

  const parts = ["import "];

  if (declarationKindPrefix) {
    if (!Array.isArray(node.specifiers) || node.specifiers.length === 0) {
      return null;
    }

    parts.push(declarationKindPrefix);
  }

  if (Array.isArray(node.specifiers) && node.specifiers.length > 0) {
    const renderedSpecifiers = renderImportSpecifiers(node.specifiers, options);

    if (!renderedSpecifiers) {
      return null;
    }

    parts.push(renderedSpecifiers, " from ");
  }

  parts.push(quoteString(node.source.value, options));

  const renderedAttributes = renderImportAttributes(node, options);

  if (renderedAttributes === null) {
    return null;
  }

  parts.push(renderedAttributes);

  if (options.semi) {
    parts.push(";");
  }

  return group(parts);
}

function print(path, options, print) {
  const node = path.node;

  if (options.singleLineImports && node?.type === "ImportDeclaration") {
    const forcedImport = renderSingleLineImport(node, options);

    if (forcedImport) {
      return forcedImport;
    }
  }

  return basePrinter.print.call(this, path, options, print);
}

export const options = {
  singleLineImports: {
    type: "boolean",
    category: "Global",
    default: false,
    description: "Keep safe import declarations on a single line.",
  },
};

export const parsers = {
  "imports-babel": {
    ...prettierPluginBabel.parsers.babel,
    astFormat: "imports-estree",
  },
  "imports-babel-ts": {
    ...prettierPluginBabel.parsers["babel-ts"],
    astFormat: "imports-estree",
  },
  "imports-typescript": {
    ...prettierPluginTypeScript.parsers.typescript,
    astFormat: "imports-estree",
  },
};

export const printers = {
  "imports-estree": {
    ...basePrinter,
    print,
  },
};
