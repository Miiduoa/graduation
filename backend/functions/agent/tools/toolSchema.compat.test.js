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

  test('dorm repair listing still defaults to 20 rows and rejects invalid limits', () => {
    const { inputSchema } = require('./listMyDormRepairs');
    expect(inputSchema.parse({})).toEqual({ limit: 20 });
    expect(inputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(inputSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(inputSchema.safeParse({ limit: 10 }).success).toBe(true);
  });

  test('all registered tools keep object-shaped model input parameters', () => {
    const failures = [];
    for (const tool of tools) {
      try {
        const [definition] = buildToolDefinitions([tool]);
        const parameters = definition.function.parameters;
        if (parameters.type !== 'object' || !parameters.properties || Array.isArray(parameters.properties)) {
          failures.push(tool.name + ': missing object parameters');
        }
      } catch (error) {
        failures.push(tool.name + ': ' + String(error.message));
      }
    }
    expect(failures).toEqual([]);
  });
});
