import path from 'node:path';
import { Project, SyntaxKind, ts } from 'ts-morph';

const typeScriptExtensions = new Set(['.ts', '.tsx', '.mts', '.cts']);

function languageFor(relativePath) {
  return typeScriptExtensions.has(path.extname(relativePath)) ? 'typescript' : 'javascript';
}

function locationFor(node) {
  return {
    startLine: node.getStartLineNumber(),
    endLine: node.getEndLineNumber()
  };
}

function makeFact(relativePath, language, fields, node) {
  return {
    ...fields,
    path: relativePath,
    language,
    provenance: 'js-ts-ast',
    location: locationFor(node)
  };
}

function parserFallbackDiagnostic(relativePath) {
  return {
    id: `js-ts-parse-fallback:${relativePath}`,
    severity: 'warning',
    message: `Parser extraction failed for ${relativePath}; regex fallback was used.`
  };
}

function hasParseDiagnostics(sourceFile) {
  return (sourceFile.compilerNode.parseDiagnostics?.length ?? 0) > 0;
}

function callExpressionImportSource(callExpression) {
  const expression = callExpression.getExpression();
  const expressionText = expression.getText();
  if (expressionText !== 'require' && expressionText !== 'import') {
    return null;
  }

  const [argument] = callExpression.getArguments();
  if (!argument || !argument.isKind(SyntaxKind.StringLiteral)) {
    return null;
  }

  return argument.getLiteralText();
}

function pushExportedDeclarationFacts(facts, relativePath, language, declarations) {
  for (const declaration of declarations) {
    if (!declaration.isExported()) {
      continue;
    }

    const name = declaration.getName?.() ?? (declaration.isDefaultExport?.() ? 'default' : null);
    facts.push(makeFact(relativePath, language, {
      kind: 'symbol',
      symbol: name || 'default'
    }, declaration));
  }
}

function extractFromSourceFile(sourceFile, relativePath) {
  const language = languageFor(relativePath);
  const facts = [];

  for (const declaration of sourceFile.getImportDeclarations()) {
    facts.push(makeFact(relativePath, language, {
      kind: 'import',
      source: declaration.getModuleSpecifierValue()
    }, declaration));
  }

  for (const declaration of sourceFile.getExportDeclarations()) {
    const source = declaration.getModuleSpecifierValue();
    if (source) {
      facts.push(makeFact(relativePath, language, {
        kind: 'export',
        source
      }, declaration));
    } else {
      for (const namedExport of declaration.getNamedExports()) {
        const localName = namedExport.getName();
        facts.push(makeFact(relativePath, language, {
          kind: 'export',
          source: localName,
          target: namedExport.getAliasNode()?.getText() ?? localName
        }, namedExport));
      }
    }
  }

  sourceFile.forEachDescendant((node) => {
    if (!node.isKind(SyntaxKind.CallExpression)) {
      return;
    }

    const source = callExpressionImportSource(node);
    if (source) {
      facts.push(makeFact(relativePath, language, {
        kind: 'import',
        source
      }, node));
    }
  });

  pushExportedDeclarationFacts(facts, relativePath, language, sourceFile.getFunctions());
  pushExportedDeclarationFacts(facts, relativePath, language, sourceFile.getClasses());
  pushExportedDeclarationFacts(facts, relativePath, language, sourceFile.getInterfaces());
  pushExportedDeclarationFacts(facts, relativePath, language, sourceFile.getTypeAliases());
  pushExportedDeclarationFacts(facts, relativePath, language, sourceFile.getEnums());

  for (const statement of sourceFile.getVariableStatements()) {
    if (!statement.isExported()) {
      continue;
    }
    for (const declaration of statement.getDeclarations()) {
      facts.push(makeFact(relativePath, language, {
        kind: 'symbol',
        symbol: declaration.getName()
      }, declaration));
    }
  }

  return facts;
}

export function extractJsTsFacts(repoPath, files) {
  const project = new Project({
    useInMemoryFileSystem: false,
    compilerOptions: {
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022
    },
    skipAddingFilesFromTsConfig: true
  });
  const facts = [];
  const diagnostics = [];

  for (const file of files) {
    const relativePath = file.path;
    try {
      const sourceFile = project.addSourceFileAtPath(path.join(repoPath, relativePath));
      if (hasParseDiagnostics(sourceFile)) {
        diagnostics.push(parserFallbackDiagnostic(relativePath));
        continue;
      }
      facts.push(...extractFromSourceFile(sourceFile, relativePath));
    } catch {
      diagnostics.push(parserFallbackDiagnostic(relativePath));
    }
  }

  facts.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  diagnostics.sort((a, b) => a.id.localeCompare(b.id));
  return { facts, diagnostics };
}
