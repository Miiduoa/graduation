import {
  findById,
  findByIdStrict,
  findByIdOrFirst,
} from '../../data/helpers';

describe('Data Helpers', () => {
  const testItems = [
    { id: 'item-1', name: 'First Item' },
    { id: 'item-2', name: 'Second Item' },
    { id: 'item-3', name: 'Third Item' },
  ];

  describe('findById', () => {
    it('should find item by id', () => {
      const result = findById(testItems, 'item-2');
      expect(result).toEqual({ id: 'item-2', name: 'Second Item' });
    });

    it('should return null when id not found', () => {
      const result = findById(testItems, 'non-existent');
      expect(result).toBeNull();
    });

    it('should return null when id is undefined', () => {
      const result = findById(testItems, undefined);
      expect(result).toBeNull();
    });

    it('should return null when id is empty string', () => {
      const result = findById(testItems, '');
      expect(result).toBeNull();
    });

    it('should return first item as fallback when id not found and fallbackToFirst is true', () => {
      const result = findById(testItems, 'non-existent', { fallbackToFirst: true });
      expect(result).toEqual({ id: 'item-1', name: 'First Item' });
    });

    it('should return first item as fallback when id is undefined and fallbackToFirst is true', () => {
      const result = findById(testItems, undefined, { fallbackToFirst: true });
      expect(result).toEqual({ id: 'item-1', name: 'First Item' });
    });

    it('should return null when array is empty and fallbackToFirst is true', () => {
      const result = findById([], 'any-id', { fallbackToFirst: true });
      expect(result).toBeNull();
    });

    it('should return found item even with fallbackToFirst option', () => {
      const result = findById(testItems, 'item-3', { fallbackToFirst: true });
      expect(result).toEqual({ id: 'item-3', name: 'Third Item' });
    });

    it('should work with empty array', () => {
      const result = findById([], 'any-id');
      expect(result).toBeNull();
    });

    it('should work with single item array', () => {
      const singleItem = [{ id: 'only', name: 'Only Item' }];
      expect(findById(singleItem, 'only')).toEqual({ id: 'only', name: 'Only Item' });
      expect(findById(singleItem, 'other')).toBeNull();
    });
  });

  describe('findByIdStrict', () => {
    it('should find item by id', () => {
      const result = findByIdStrict(testItems, 'item-1');
      expect(result).toEqual({ id: 'item-1', name: 'First Item' });
    });

    it('should return null when id not found', () => {
      const result = findByIdStrict(testItems, 'non-existent');
      expect(result).toBeNull();
    });

    it('should return null for empty array', () => {
      const result = findByIdStrict([], 'any-id');
      expect(result).toBeNull();
    });

    it('should find last item', () => {
      const result = findByIdStrict(testItems, 'item-3');
      expect(result).toEqual({ id: 'item-3', name: 'Third Item' });
    });
  });

  describe('findByIdOrFirst', () => {
    it('should find item by id', () => {
      const result = findByIdOrFirst(testItems, 'item-2');
      expect(result).toEqual({ id: 'item-2', name: 'Second Item' });
    });

    it('should return first item when id not found', () => {
      const result = findByIdOrFirst(testItems, 'non-existent');
      expect(result).toEqual({ id: 'item-1', name: 'First Item' });
    });

    it('should return first item when id is undefined', () => {
      const result = findByIdOrFirst(testItems, undefined);
      expect(result).toEqual({ id: 'item-1', name: 'First Item' });
    });

    it('should return first item when id is empty string', () => {
      const result = findByIdOrFirst(testItems, '');
      expect(result).toEqual({ id: 'item-1', name: 'First Item' });
    });

    it('should return null for empty array', () => {
      const result = findByIdOrFirst([], 'any-id');
      expect(result).toBeNull();
    });

    it('should return null for empty array with undefined id', () => {
      const result = findByIdOrFirst([], undefined);
      expect(result).toBeNull();
    });

    it('should work with single item array', () => {
      const singleItem = [{ id: 'only', name: 'Only Item' }];
      expect(findByIdOrFirst(singleItem, 'only')).toEqual({ id: 'only', name: 'Only Item' });
      expect(findByIdOrFirst(singleItem, 'other')).toEqual({ id: 'only', name: 'Only Item' });
      expect(findByIdOrFirst(singleItem, undefined)).toEqual({ id: 'only', name: 'Only Item' });
    });
  });

  describe('type compatibility', () => {
    it('should work with different object shapes', () => {
      const complexItems = [
        { id: 'a', value: 1, nested: { x: 10 } },
        { id: 'b', value: 2, nested: { x: 20 } },
      ];

      const result = findById(complexItems, 'b');
      expect(result).toEqual({ id: 'b', value: 2, nested: { x: 20 } });
    });

    it('should work with items having additional properties', () => {
      const extendedItems = [
        { id: '1', name: 'Item 1', extra: 'data', count: 5 },
        { id: '2', name: 'Item 2', extra: 'more', count: 10 },
      ];

      const result = findByIdStrict(extendedItems, '2');
      expect(result?.extra).toBe('more');
      expect(result?.count).toBe(10);
    });
  });
});
