'use strict';

const { z } = require('zod');
const { buildToolDefinitions } = require('../../assistantAgent');
const { tools } = require('./registry');

describe('assistant function-calling schema contract', () => {
  test('preserves required fields and nested restrictions', () => {
    const schema = z.object({
      courseId: z.string().min(1),
      questions: z.array(z.object({ questionId: z.string().min(1) })).min(1),
      limit: z.number().int().min(1).max(5).optional(),
    });
    const [definition] = buildToolDefinitions([{ name: 'sample', inputSchema: schema }]);
    const parameters = definition.function.parameters;

    expect(parameters.type).toBe('object');
    expect(parameters.required).toEqual(expect.arrayContaining(['courseId', 'questions']));
    expect(parameters.required).not.toContain('limit');
    expect(parameters.properties.courseId).toMatchObject({ type: 'string', minLength: 1 });
    expect(parameters.properties.questions).toMatchObject({ type: 'array', minItems: 1 });
    expect(parameters.properties.questions.items.properties.questionId).toMatchObject({
      type: 'string',
      minLength: 1,
    });
  });

  test('rejects invalid tool schema rather than sending an empty object', () => {
    expect(() => buildToolDefinitions([{ name: 'bad', inputSchema: z.string() }])).toThrow(
      /OpenAPI object/,
    );
  });

  test('all registered tools keep object-shaped model input parameters', () => {
    const definitions = buildToolDefinitions(tools);
    expect(definitions).toHaveLength(tools.length);
    for (const definition of definitions) {
      const parameters = definition.function.parameters;
      expect(parameters.type).toBe('object');
      expect(parameters.properties).toEqual(expect.any(Object));
      expect(Array.isArray(parameters.properties)).toBe(false);
    }
  });
});
