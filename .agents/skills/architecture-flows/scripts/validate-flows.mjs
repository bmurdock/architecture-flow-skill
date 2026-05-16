#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const confidenceValues = new Set(['high', 'medium', 'low']);
const requiredRootFields = ['schemaVersion', 'metadata', 'evidence', 'nodes', 'edges', 'flows'];
const requiredMetadataFields = ['repository', 'branch', 'commit', 'generatedAt', 'generationMode', 'privacy'];
const requiredEvidenceFields = ['id', 'kind', 'path', 'provenance', 'reason'];
const requiredNodeFields = ['id', 'kind', 'label', 'evidence', 'confidence'];
const requiredEdgeFields = ['id', 'kind', 'from', 'to', 'evidence', 'confidence'];
const requiredFlowFields = ['id', 'name', 'summary', 'trigger', 'steps'];
const requiredStepFields = ['id', 'order', 'node', 'description', 'evidence', 'confidence'];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(scriptDir, '../references/architecture-flows.schema.json');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${filePath}: cannot read JSON: ${error.message}`);
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function addRequiredErrors(errors, value, fields, prefix) {
  for (const field of fields) {
    if (!isObject(value) || !hasOwn(value, field)) {
      errors.push(`${prefix}.${field} is required`);
    }
  }
}

function requireArray(errors, value, field, prefix) {
  if (!Array.isArray(value?.[field])) {
    errors.push(`${prefix}.${field} must be an array`);
    return [];
  }
  return value[field];
}

function resolveRef(schema, ref) {
  if (!ref.startsWith('#/')) {
    throw new Error(`Unsupported schema reference: ${ref}`);
  }

  return ref
    .slice(2)
    .split('/')
    .reduce((value, segment) => value?.[segment], schema);
}

function childContext(context, key) {
  return context === 'root' ? key : `${context}.${key}`;
}

function validateSchemaType(errors, schemaNode, value, context) {
  if (!schemaNode.type) {
    return true;
  }

  const types = Array.isArray(schemaNode.type) ? schemaNode.type : [schemaNode.type];
  const matches = types.some((type) => {
    if (type === 'array') return Array.isArray(value);
    if (type === 'integer') return Number.isInteger(value);
    if (type === 'object') return isObject(value);
    if (type === 'null') return value === null;
    return typeof value === type;
  });

  if (!matches) {
    errors.push(`${context} must be ${types.join(' or ')}`);
  }

  return matches;
}

function validateAgainstSchema(errors, rootSchema, schemaNode, value, context = 'root') {
  if (schemaNode.$ref) {
    const resolved = resolveRef(rootSchema, schemaNode.$ref);
    validateAgainstSchema(errors, rootSchema, resolved, value, context);
    return;
  }

  if (!validateSchemaType(errors, schemaNode, value, context)) {
    return;
  }

  if (schemaNode.enum && !schemaNode.enum.includes(value)) {
    errors.push(`${context} must be one of: ${schemaNode.enum.join(', ')}`);
  }

  if (typeof value === 'string' && schemaNode.minLength && value.length < schemaNode.minLength) {
    errors.push(`${context} must not be empty`);
  }

  if (schemaNode.format === 'date-time' && typeof value === 'string' && Number.isNaN(Date.parse(value))) {
    errors.push(`${context} must be a valid date-time`);
  }

  if (typeof value === 'number' && schemaNode.minimum !== undefined && value < schemaNode.minimum) {
    errors.push(`${context} must be greater than or equal to ${schemaNode.minimum}`);
  }

  if (Array.isArray(value)) {
    if (schemaNode.minItems !== undefined && value.length < schemaNode.minItems) {
      errors.push(`${context} must include at least ${schemaNode.minItems} item(s)`);
    }

    if (schemaNode.items) {
      value.forEach((item, index) => {
        validateAgainstSchema(errors, rootSchema, schemaNode.items, item, `${context}[${index}]`);
      });
    }
  }

  if (isObject(value)) {
    for (const field of schemaNode.required ?? []) {
      if (!hasOwn(value, field)) {
        errors.push(`${childContext(context, field)} is required`);
      }
    }

    if (schemaNode.additionalProperties === false) {
      const allowedProperties = new Set(Object.keys(schemaNode.properties ?? {}));
      for (const key of Object.keys(value)) {
        if (!allowedProperties.has(key)) {
          const propertyContext = context === 'root' ? `root.${key}` : childContext(context, key);
          errors.push(`${propertyContext} is not allowed`);
        }
      }
    }

    for (const [key, propertySchema] of Object.entries(schemaNode.properties ?? {})) {
      if (hasOwn(value, key)) {
        validateAgainstSchema(errors, rootSchema, propertySchema, value[key], childContext(context, key));
      }
    }
  }
}

function collectIds(errors, items, label) {
  const ids = new Set();
  for (const item of items) {
    if (!isObject(item) || typeof item.id !== 'string' || item.id.length === 0) {
      continue;
    }
    if (ids.has(item.id)) {
      errors.push(`Duplicate ${label} id "${item.id}"`);
    }
    ids.add(item.id);
  }
  return ids;
}

function validateConfidence(errors, confidence, context, item) {
  if (!isObject(confidence)) {
    errors.push(`${context}.confidence must be an object`);
    return;
  }

  addRequiredErrors(errors, confidence, ['overall'], `${context}.confidence`);

  for (const [dimension, value] of Object.entries(confidence)) {
    if (!confidenceValues.has(value)) {
      errors.push(`Invalid confidence value "${value}" at ${context}.confidence.${dimension}`);
    }
  }

  if (Object.values(confidence).includes('low') && !item.uncertaintyReason) {
    errors.push(`${context} uses low confidence and must include uncertaintyReason`);
  }
}

function validateEvidenceReferences(errors, evidenceRefs, evidenceIds, context) {
  if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0) {
    errors.push(`${context}.evidence must include at least one evidence id`);
    return;
  }

  for (const evidenceId of evidenceRefs) {
    if (!evidenceIds.has(evidenceId)) {
      errors.push(`Unknown evidence reference "${evidenceId}" at ${context}.evidence`);
    }
  }
}

function validateFactReferences(errors, factRefs, factIds, context) {
  if (factRefs === undefined) {
    return;
  }

  if (!Array.isArray(factRefs) || factRefs.length === 0) {
    errors.push(`${context}.derivedFrom must include at least one fact id when present`);
    return;
  }

  for (const factId of factRefs) {
    if (!factIds.has(factId)) {
      errors.push(`Unknown fact reference "${factId}" at ${context}.derivedFrom`);
    }
  }
}

function validateNodeReference(errors, nodeId, nodeIds, context) {
  if (nodeId && !nodeIds.has(nodeId)) {
    errors.push(`Unknown node reference "${nodeId}" at ${context}`);
  }
}

function validateEdgeReference(errors, edgeId, edgeIds, context) {
  if (edgeId && !edgeIds.has(edgeId)) {
    errors.push(`Unknown edge reference "${edgeId}" at ${context}`);
  }
}

function validateArtifact(artifact) {
  const errors = [];

  if (!isObject(artifact)) {
    return ['root must be an object'];
  }

  addRequiredErrors(errors, artifact, requiredRootFields, 'root');
  addRequiredErrors(errors, artifact.metadata, requiredMetadataFields, 'metadata');

  const evidence = requireArray(errors, artifact, 'evidence', 'root');
  const nodes = requireArray(errors, artifact, 'nodes', 'root');
  const edges = requireArray(errors, artifact, 'edges', 'root');
  const flows = requireArray(errors, artifact, 'flows', 'root');
  const diagnostics = Array.isArray(artifact.diagnostics) ? artifact.diagnostics : [];
  const facts = Array.isArray(artifact.facts) ? artifact.facts : [];

  evidence.forEach((item, index) => {
    addRequiredErrors(errors, item, requiredEvidenceFields, `evidence[${index}]`);
  });

  nodes.forEach((item, index) => {
    addRequiredErrors(errors, item, requiredNodeFields, `nodes[${index}]`);
    validateConfidence(errors, item?.confidence, `nodes[${index}]`, item ?? {});
  });

  edges.forEach((item, index) => {
    addRequiredErrors(errors, item, requiredEdgeFields, `edges[${index}]`);
    validateConfidence(errors, item?.confidence, `edges[${index}]`, item ?? {});
  });

  flows.forEach((flow, flowIndex) => {
    addRequiredErrors(errors, flow, requiredFlowFields, `flows[${flowIndex}]`);
    const steps = Array.isArray(flow?.steps) ? flow.steps : [];
    if (!Array.isArray(flow?.steps) || flow.steps.length === 0) {
      errors.push(`flows[${flowIndex}].steps must include at least one step`);
    }
    steps.forEach((step, stepIndex) => {
      addRequiredErrors(errors, step, requiredStepFields, `flows[${flowIndex}].steps[${stepIndex}]`);
      validateConfidence(errors, step?.confidence, `flows[${flowIndex}].steps[${stepIndex}]`, step ?? {});
    });
  });

  const evidenceIds = collectIds(errors, evidence, 'evidence');
  const nodeIds = collectIds(errors, nodes, 'node');
  const edgeIds = collectIds(errors, edges, 'edge');
  const factIds = collectIds(errors, facts, 'fact');
  collectIds(errors, flows, 'flow');

  facts.forEach((fact, index) => {
    validateEvidenceReferences(errors, fact?.evidence, evidenceIds, `facts[${index}]`);
  });

  nodes.forEach((node, index) => {
    validateEvidenceReferences(errors, node?.evidence, evidenceIds, `nodes[${index}]`);
    validateFactReferences(errors, node?.derivedFrom, factIds, `nodes[${index}]`);
  });

  edges.forEach((edge, index) => {
    validateNodeReference(errors, edge?.from, nodeIds, `edges[${index}].from`);
    validateNodeReference(errors, edge?.to, nodeIds, `edges[${index}].to`);
    validateEvidenceReferences(errors, edge?.evidence, evidenceIds, `edges[${index}]`);
    validateFactReferences(errors, edge?.derivedFrom, factIds, `edges[${index}]`);
  });

  flows.forEach((flow, flowIndex) => {
    validateNodeReference(errors, flow?.entry, nodeIds, `flows[${flowIndex}].entry`);
    validateNodeReference(errors, flow?.exit, nodeIds, `flows[${flowIndex}].exit`);

    for (const [stepIndex, step] of (flow?.steps ?? []).entries()) {
      validateNodeReference(errors, step?.node, nodeIds, `flows[${flowIndex}].steps[${stepIndex}].node`);
      validateEdgeReference(errors, step?.edge, edgeIds, `flows[${flowIndex}].steps[${stepIndex}].edge`);
      validateEvidenceReferences(errors, step?.evidence, evidenceIds, `flows[${flowIndex}].steps[${stepIndex}]`);
      validateFactReferences(
        errors,
        step?.derivedFrom,
        factIds,
        `flows[${flowIndex}].steps[${stepIndex}]`
      );
    }
  });

  diagnostics.forEach((diagnostic, index) => {
    if (Array.isArray(diagnostic?.evidence)) {
      validateEvidenceReferences(errors, diagnostic.evidence, evidenceIds, `diagnostics[${index}]`);
    }
  });

  return errors;
}

function main() {
  const files = process.argv.slice(2);
  if (files.length === 0 || files.includes('--help')) {
    console.error('Usage: validate-flows.mjs <architecture-flows.json> [...]');
    process.exit(files.includes('--help') ? 0 : 2);
  }

  if (!fs.existsSync(schemaPath)) {
    console.error(`Schema file not found: ${schemaPath}`);
    process.exit(2);
  }

  const schema = readJson(schemaPath);
  let failed = false;
  for (const file of files) {
    const artifact = readJson(file);
    const schemaErrors = [];
    validateAgainstSchema(schemaErrors, schema, schema, artifact);
    const errors = [...schemaErrors, ...validateArtifact(artifact)];

    if (errors.length > 0) {
      failed = true;
      console.error(`${file}: invalid`);
      for (const error of errors) {
        console.error(`- ${error}`);
      }
    } else {
      console.log(`${file}: valid`);
    }
  }

  process.exit(failed ? 1 : 0);
}

main();
