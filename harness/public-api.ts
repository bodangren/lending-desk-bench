/**
 * Stable public TypeScript API signatures for the writable candidate surface.
 *
 * Function bodies and trivia are deliberately excluded: the benchmark protects
 * exported names and declarations, not implementation formatting.
 */
import ts from "typescript";
import { readFileSync } from "node:fs";

function compact(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n\r]*/g, "")
    .replace(/\s+/g, "")
    .replace(/;/g, ",")
    .replace(/,+([}\]])/g, "$1");
}

function exported(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

function defaultExport(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Default) !== 0;
}

type AliasContext = {
  imports: Map<string, string>;
  privateAliases: Map<string, ts.TypeAliasDeclaration>;
  privateInterfaces: Map<string, ts.InterfaceDeclaration>;
};

function aliasesFor(source: ts.SourceFile): AliasContext {
  const imports = new Map<string, string>();
  const privateAliases = new Map<string, ts.TypeAliasDeclaration>();
  const privateInterfaces = new Map<string, ts.InterfaceDeclaration>();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause && ts.isStringLiteral(statement.moduleSpecifier)) {
      const module = statement.moduleSpecifier.text;
      const clause = statement.importClause;
      if (clause.name) imports.set(clause.name.text, `import:${module}:default`);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const binding of clause.namedBindings.elements) {
          imports.set(binding.name.text, `import:${module}:${binding.propertyName?.text ?? binding.name.text}`);
        }
      }
    } else if (ts.isTypeAliasDeclaration(statement) && !exported(statement)) {
      privateAliases.set(statement.name.text, statement);
    } else if (ts.isInterfaceDeclaration(statement) && !exported(statement)) {
      privateInterfaces.set(statement.name.text, statement);
    }
  }
  return { imports, privateAliases, privateInterfaces };
}

function entityName(node: ts.EntityName): string {
  return ts.isIdentifier(node) ? node.text : entityName(node.left) + "." + node.right.text;
}

function memberName(node: ts.NamedDeclaration, source: ts.SourceFile): string {
  return node.name ? compact(node.name.getText(source)) : "anonymous";
}

function semanticType(node: ts.TypeNode | undefined, source: ts.SourceFile, aliases: AliasContext, resolving = new Set<string>()): string {
  if (!node) return "inferred";
  if (ts.isParenthesizedTypeNode(node)) return semanticType(node.type, source, aliases, resolving);
  if (ts.isTypeReferenceNode(node)) {
    const name = entityName(node.typeName);
    const args = (node.typeArguments ?? []).map((argument) => semanticType(argument, source, aliases, resolving)).join(",");
    const alias = aliases.privateAliases.get(name);
    if (alias) {
      if (resolving.has(name)) return `recursive:${name}`;
      resolving.add(name);
      const result = semanticType(alias.type, source, aliases, resolving);
      resolving.delete(name);
      return result;
    }
    const privateInterface = aliases.privateInterfaces.get(name);
    if (privateInterface) return "object{" + typeMembers(privateInterface.members, source, aliases, resolving) + "}";
    return `reference:${aliases.imports.get(name) ?? name}<${args}>`;
  }
  if (ts.isUnionTypeNode(node)) return "union(" + node.types.map((type) => semanticType(type, source, aliases, resolving)).sort().join("|") + ")";
  if (ts.isIntersectionTypeNode(node)) return "intersection(" + node.types.map((type) => semanticType(type, source, aliases, resolving)).sort().join("&") + ")";
  if (ts.isArrayTypeNode(node)) return "array(" + semanticType(node.elementType, source, aliases, resolving) + ")";
  if (ts.isTupleTypeNode(node)) return "tuple(" + node.elements.map((element) => semanticType(ts.isNamedTupleMember(element) ? element.type : element, source, aliases, resolving)).join(",") + ")";
  if (ts.isTypeLiteralNode(node)) return "object{" + typeMembers(node.members, source, aliases, resolving) + "}";
  if (ts.isFunctionTypeNode(node)) return "function-type:" + signatureParts(node, source, aliases, resolving);
  if (ts.isTypeOperatorNode(node)) return `${ts.SyntaxKind[node.operator]}(${semanticType(node.type, source, aliases, resolving)})`;
  if (ts.isIndexedAccessTypeNode(node)) return `indexed(${semanticType(node.objectType, source, aliases, resolving)},${semanticType(node.indexType, source, aliases, resolving)})`;
  if (ts.isConditionalTypeNode(node)) return `conditional(${semanticType(node.checkType, source, aliases, resolving)},${semanticType(node.extendsType, source, aliases, resolving)},${semanticType(node.trueType, source, aliases, resolving)},${semanticType(node.falseType, source, aliases, resolving)})`;
  if (ts.isLiteralTypeNode(node)) {
    const literal = node.literal;
    return ts.isStringLiteral(literal) ? "literal:" + JSON.stringify(literal.text) : "literal:" + compact(literal.getText(source));
  }
  return ts.SyntaxKind[node.kind];
}

function typeMembers(members: ts.NodeArray<ts.TypeElement>, source: ts.SourceFile, aliases: AliasContext, resolving: Set<string>): string {
  return members.map((member) => {
    const optional = "questionToken" in member && member.questionToken ? "?" : "";
    const readonly = ts.canHaveModifiers(member) && ts.getModifiers(member)?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword) ? "readonly:" : "";
    if (ts.isPropertySignature(member)) return `${readonly}property:${memberName(member, source)}${optional}:${semanticType(member.type, source, aliases, resolving)}`;
    if (ts.isMethodSignature(member)) return `${readonly}method:${memberName(member, source)}${optional}:${signatureParts(member, source, aliases, resolving)}`;
    if (ts.isCallSignatureDeclaration(member)) return "call:" + signatureParts(member, source, aliases, resolving);
    if (ts.isConstructSignatureDeclaration(member)) return "construct:" + signatureParts(member, source, aliases, resolving);
    if (ts.isIndexSignatureDeclaration(member)) return "index:" + signatureParts(member, source, aliases, resolving);
    return `member:${ts.SyntaxKind[member.kind]}`;
  }).sort().join(";");
}

function signatureParts(node: ts.SignatureDeclarationBase, source: ts.SourceFile, aliases: AliasContext, resolving = new Set<string>()): string {
  const generics = (node.typeParameters ?? []).map((parameter) => `${semanticType(parameter.constraint, source, aliases, resolving)}=${semanticType(parameter.default, source, aliases, resolving)}`).join(",");
  const parameters = node.parameters.map((parameter) => `${parameter.dotDotDotToken ? "rest" : ""}${parameter.questionToken ? "optional" : "required"}:${semanticType(parameter.type, source, aliases, resolving)}`).join(",");
  return `<${generics}>(${parameters}):${semanticType(node.type, source, aliases, resolving)}`;
}

function semanticFunctionSignature(node: ts.FunctionDeclaration, source: ts.SourceFile, aliases: AliasContext): string {
  const modifiers = [
    node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ? "async" : "sync",
    node.asteriskToken ? "generator" : "ordinary",
  ].join(":");
  return modifiers + ":" + signatureParts(node, source, aliases);
}

function declarationKind(list: ts.VariableDeclarationList): string {
  if (list.flags & ts.NodeFlags.Const) return "const";
  if (list.flags & ts.NodeFlags.Let) return "let";
  return "var";
}

function variableSignature(declaration: ts.VariableDeclaration, source: ts.SourceFile, aliases: AliasContext): string {
  if (declaration.type) return semanticType(declaration.type, source, aliases);
  const initializer = declaration.initializer;
  if (initializer && ts.isStringLiteral(initializer)) return "literal:" + JSON.stringify(initializer.text);
  if (initializer && ts.isNumericLiteral(initializer)) return "literal:" + String(Number(initializer.text));
  if (initializer?.kind === ts.SyntaxKind.TrueKeyword || initializer?.kind === ts.SyntaxKind.FalseKeyword) return "literal:" + initializer.kind;
  return initializer ? "inferred:" + ts.SyntaxKind[initializer.kind] : "inferred";
}

function exportDeclarationSignature(statement: ts.ExportDeclaration, source: ts.SourceFile): string {
  const module = statement.moduleSpecifier ? compact(statement.moduleSpecifier.getText(source)) : "local";
  if (!statement.exportClause) return "re-export:star:" + module;
  if (ts.isNamedExports(statement.exportClause)) {
    return "re-export:named:" + statement.exportClause.elements.map((item) => `${item.name.text}:${item.propertyName?.text ?? item.name.text}`).sort().join(",") + ":" + module;
  }
  return "re-export:namespace:" + memberName(statement.exportClause, source) + ":" + module;
}

/** Canonical, semantic descriptors for every top-level public declaration. */
export function canonicalPublicSurface(path: string): string[] {
  const text = readFileSync(path, "utf8");
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const aliases = aliasesFor(source);
  const descriptors: string[] = [];
  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) {
      descriptors.push(`export-assignment:${statement.isExportEquals ? "equals" : "default"}`);
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      descriptors.push(exportDeclarationSignature(statement, source));
      continue;
    }
    if (!exported(statement)) continue;
    if (ts.isFunctionDeclaration(statement)) {
      descriptors.push(`${defaultExport(statement) ? "default" : statement.name?.text ?? "anonymous"}:function:${semanticFunctionSignature(statement, source, aliases)}`);
    } else if (ts.isTypeAliasDeclaration(statement)) {
      descriptors.push(`type:${statement.name.text}:${semanticType(statement.type, source, aliases)}`);
    } else if (ts.isInterfaceDeclaration(statement)) {
      descriptors.push(`interface:${statement.name.text}:object{${typeMembers(statement.members, source, aliases, new Set<string>())}}`);
    } else if (ts.isClassDeclaration(statement)) {
      descriptors.push(`${defaultExport(statement) ? "default" : statement.name?.text ?? "anonymous"}:class`);
    } else if (ts.isVariableStatement(statement)) {
      const kind = declarationKind(statement.declarationList);
      for (const declaration of statement.declarationList.declarations) {
        descriptors.push(`${declaration.name.getText(source)}:${kind}:${variableSignature(declaration, source, aliases)}`);
      }
    } else {
      descriptors.push(`other:${ts.SyntaxKind[statement.kind]}`);
    }
  }
  return descriptors.sort();
}
