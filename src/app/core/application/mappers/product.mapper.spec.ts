import { describe, it, expect } from 'vitest';
import { productMapper, ProductMapper } from '@core/application/mappers/product.mapper';
import { Product } from '@core/domain/entities/product.entity';
import { ProductBuilder } from '@core/domain/entities/product.builder';
import {
  CreateProductDto,
  UpdateProductDto,
  ProductResponseDto,
} from '@core/application/dtos/product.dto';

describe('ProductMapper', () => {
  describe('toDomain', () => {
    it('should map CreateProductDto to Product entity', () => {
      const dto: CreateProductDto = {
        name: 'Test Product',
        price: 99.99,
        sku: 'TEST-001',
        category: 'Electronics',
        stock: 10,
        description: 'Test description',
        imageUrl: 'https://example.com/image.jpg',
        barcode: '1234567890',
        emoji: '📱',
      };

      const product = productMapper.toDomain(dto, 'test-id');

      expect(product).toBeInstanceOf(Product);
      expect(product.id).toBe('test-id');
      expect(product.name).toBe(dto.name);
      expect(product.price).toBe(dto.price);
      expect(product.sku).toBe(dto.sku);
      expect(product.category).toBe(dto.category);
      expect(product.stock).toBe(dto.stock);
      expect(product.description).toBe(dto.description);
      expect(product.imageUrl).toBe(dto.imageUrl);
      expect(product.barcode).toBe(dto.barcode);
      expect(product.emoji).toBe(dto.emoji);
    });

    it('should generate UUID if id not provided', () => {
      const dto: CreateProductDto = {
        name: 'Test Product',
        price: 99.99,
        sku: 'TEST-001',
        category: 'Electronics',
        stock: 10,
      };

      const product = productMapper.toDomain(dto);

      expect(product.id).toBeDefined();
      expect(product.id.length).toBeGreaterThan(0);
    });
  });

  describe('toResponseDto', () => {
    it('should map Product entity to ProductResponseDto', () => {
      const product = new ProductBuilder()
        .withId('test-id')
        .withName('Test Product')
        .withPrice(99.99)
        .withSku('TEST-001')
        .withCategory('Electronics')
        .withStock(10)
        .withDescription('Test description')
        .withImageUrl('https://example.com/image.jpg')
        .withBarcode('1234567890')
        .withEmoji('📱')
        .build();

      const dto = productMapper.toResponseDto(product);

      expect(dto.id).toBe(product.id);
      expect(dto.name).toBe(product.name);
      expect(dto.price).toBe(product.price);
      expect(dto.sku).toBe(product.sku);
      expect(dto.category).toBe(product.category);
      expect(dto.stock).toBe(product.stock);
      expect(dto.description).toBe(product.description);
      expect(dto.imageUrl).toBe(product.imageUrl);
      expect(dto.barcode).toBe(product.barcode);
      expect(dto.emoji).toBe(product.emoji);
      expect(dto.createdAt).toBeDefined();
      expect(dto.updatedAt).toBeDefined();
    });

    it('should convert dates to ISO strings', () => {
      const product = new ProductBuilder()
        .withId('test-id')
        .withName('Test Product')
        .withPrice(99.99)
        .withSku('TEST-001')
        .withCategory('Electronics')
        .withStock(10)
        .build();

      const dto = productMapper.toResponseDto(product);

      expect(typeof dto.createdAt).toBe('string');
      expect(typeof dto.updatedAt).toBe('string');
      expect(() => new Date(dto.createdAt)).not.toThrow();
      expect(() => new Date(dto.updatedAt)).not.toThrow();
    });
  });

  describe('fromResponseDto', () => {
    it('should map ProductResponseDto to Product entity', () => {
      const dto = new ProductResponseDto(
        'test-id',
        'Test Product',
        99.99,
        'TEST-001',
        'Electronics',
        10,
        new Date().toISOString(),
        new Date().toISOString(),
        'Test description',
        'https://example.com/image.jpg',
        '1234567890',
        '📱'
      );

      const product = productMapper.fromResponseDto(dto);

      expect(product).toBeInstanceOf(Product);
      expect(product.id).toBe(dto.id);
      expect(product.name).toBe(dto.name);
      expect(product.price).toBe(dto.price);
      expect(product.sku).toBe(dto.sku);
      expect(product.category).toBe(dto.category);
      expect(product.stock).toBe(dto.stock);
      expect(product.description).toBe(dto.description);
      expect(product.imageUrl).toBe(dto.imageUrl);
      expect(product.barcode).toBe(dto.barcode);
      expect(product.emoji).toBe(dto.emoji);
    });

    it('should convert ISO strings to Date objects', () => {
      const now = new Date();
      const dto = new ProductResponseDto(
        'test-id',
        'Test Product',
        99.99,
        'TEST-001',
        'Electronics',
        10,
        now.toISOString(),
        now.toISOString()
      );

      const product = productMapper.fromResponseDto(dto);

      expect(product.createdAt).toBeInstanceOf(Date);
      expect(product.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('applyUpdate', () => {
    it('should apply UpdateProductDto to Product entity', () => {
      const product = new ProductBuilder()
        .withId('test-id')
        .withName('Original Name')
        .withPrice(99.99)
        .withSku('TEST-001')
        .withCategory('Electronics')
        .withStock(10)
        .build();

      const updateDto = new UpdateProductDto('Updated Name', 149.99, undefined, undefined, 20);

      const updated = productMapper.applyUpdate(product, updateDto);

      expect(updated.name).toBe('Updated Name');
      expect(updated.price).toBe(149.99);
      expect(updated.stock).toBe(20);
      expect(updated.sku).toBe('TEST-001'); // Unchanged
      expect(updated.category).toBe('Electronics'); // Unchanged
    });

    it('should not modify original entity', () => {
      const product = new ProductBuilder()
        .withId('test-id')
        .withName('Original Name')
        .withPrice(99.99)
        .withSku('TEST-001')
        .withCategory('Electronics')
        .withStock(10)
        .build();

      const updateDto = new UpdateProductDto('Updated Name');

      productMapper.applyUpdate(product, updateDto);

      expect(product.name).toBe('Original Name'); // Original unchanged
    });

    it('should handle partial updates', () => {
      const product = new ProductBuilder()
        .withId('test-id')
        .withName('Original Name')
        .withPrice(99.99)
        .withSku('TEST-001')
        .withCategory('Electronics')
        .withStock(10)
        .build();

      const updateDto = new UpdateProductDto(undefined, 149.99);

      const updated = productMapper.applyUpdate(product, updateDto);

      expect(updated.name).toBe('Original Name');
      expect(updated.price).toBe(149.99);
    });
  });

  describe('toResponseDtoList', () => {
    it('should map array of Product entities to array of DTOs', () => {
      const products = [
        new ProductBuilder()
          .withId('id-1')
          .withName('Product 1')
          .withPrice(10)
          .withSku('SKU-1')
          .withCategory('Cat1')
          .withStock(5)
          .build(),
        new ProductBuilder()
          .withId('id-2')
          .withName('Product 2')
          .withPrice(20)
          .withSku('SKU-2')
          .withCategory('Cat2')
          .withStock(10)
          .build(),
      ];

      const dtos = productMapper.toResponseDtoList(products);

      expect(dtos).toHaveLength(2);
      expect(dtos[0].id).toBe('id-1');
      expect(dtos[1].id).toBe('id-2');
    });

    it('should handle empty array', () => {
      const dtos = productMapper.toResponseDtoList([]);
      expect(dtos).toHaveLength(0);
    });
  });

  describe('fromResponseDtoList', () => {
    it('should map array of DTOs to array of Product entities', () => {
      const dtos: ProductResponseDto[] = [
        new ProductResponseDto(
          'id-1',
          'Product 1',
          10,
          'SKU-1',
          'Cat1',
          5,
          new Date().toISOString(),
          new Date().toISOString()
        ),
        new ProductResponseDto(
          'id-2',
          'Product 2',
          20,
          'SKU-2',
          'Cat2',
          10,
          new Date().toISOString(),
          new Date().toISOString()
        ),
      ];

      const products = productMapper.fromResponseDtoList(dtos);

      expect(products).toHaveLength(2);
      expect(products[0]).toBeInstanceOf(Product);
      expect(products[1]).toBeInstanceOf(Product);
      expect(products[0].id).toBe('id-1');
      expect(products[1].id).toBe('id-2');
    });

    it('should handle empty array', () => {
      const products = productMapper.fromResponseDtoList([]);
      expect(products).toHaveLength(0);
    });
  });

  describe('applyUpdate with all optional fields', () => {
    it('should update sku when provided', () => {
      const product = new ProductBuilder()
        .withId('test-id')
        .withName('Product')
        .withPrice(10)
        .withSku('OLD-SKU')
        .withCategory('Cat')
        .withStock(5)
        .build();

      const updateDto = new UpdateProductDto(undefined, undefined, 'NEW-SKU');
      const updated = productMapper.applyUpdate(product, updateDto);

      expect(updated.sku).toBe('NEW-SKU');
    });

    it('should update category when provided', () => {
      const product = new ProductBuilder()
        .withId('test-id')
        .withName('Product')
        .withPrice(10)
        .withSku('SKU-1')
        .withCategory('OldCat')
        .withStock(5)
        .build();

      const updateDto = new UpdateProductDto(undefined, undefined, undefined, 'NewCat');
      const updated = productMapper.applyUpdate(product, updateDto);

      expect(updated.category).toBe('NewCat');
    });

    it('should update description when provided', () => {
      const product = new ProductBuilder()
        .withId('test-id')
        .withName('Product')
        .withPrice(10)
        .withSku('SKU-1')
        .withCategory('Cat')
        .withStock(5)
        .withDescription('Old desc')
        .build();

      const updateDto = new UpdateProductDto(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'New desc'
      );
      const updated = productMapper.applyUpdate(product, updateDto);

      expect(updated.description).toBe('New desc');
    });

    it('should update imageUrl when provided', () => {
      const product = new ProductBuilder()
        .withId('test-id')
        .withName('Product')
        .withPrice(10)
        .withSku('SKU-1')
        .withCategory('Cat')
        .withStock(5)
        .build();

      const updateDto = new UpdateProductDto(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'https://new.img/pic.png'
      );
      const updated = productMapper.applyUpdate(product, updateDto);

      expect(updated.imageUrl).toBe('https://new.img/pic.png');
    });

    it('should update barcode when provided', () => {
      const product = new ProductBuilder()
        .withId('test-id')
        .withName('Product')
        .withPrice(10)
        .withSku('SKU-1')
        .withCategory('Cat')
        .withStock(5)
        .build();

      const updateDto = new UpdateProductDto(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        '9876543210'
      );
      const updated = productMapper.applyUpdate(product, updateDto);

      expect(updated.barcode).toBe('9876543210');
    });

    it('should update emoji when provided', () => {
      const product = new ProductBuilder()
        .withId('test-id')
        .withName('Product')
        .withPrice(10)
        .withSku('SKU-1')
        .withCategory('Cat')
        .withStock(5)
        .withEmoji('🔵')
        .build();

      const updateDto = new UpdateProductDto(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        '🟢'
      );
      const updated = productMapper.applyUpdate(product, updateDto);

      expect(updated.emoji).toBe('🟢');
    });

    it('should update all optional fields simultaneously', () => {
      const product = new ProductBuilder()
        .withId('test-id')
        .withName('Product')
        .withPrice(10)
        .withSku('SKU-1')
        .withCategory('Cat')
        .withStock(5)
        .build();

      const updateDto = new UpdateProductDto(
        'New Name',
        99.99,
        'NEW-SKU',
        'NewCat',
        100,
        'New desc',
        'https://img.com/new.png',
        '1111111111',
        '🎉'
      );
      const updated = productMapper.applyUpdate(product, updateDto);

      expect(updated.name).toBe('New Name');
      expect(updated.price).toBe(99.99);
      expect(updated.sku).toBe('NEW-SKU');
      expect(updated.category).toBe('NewCat');
      expect(updated.stock).toBe(100);
      expect(updated.description).toBe('New desc');
      expect(updated.imageUrl).toBe('https://img.com/new.png');
      expect(updated.barcode).toBe('1111111111');
      expect(updated.emoji).toBe('🎉');
    });
  });

  describe('singleton getInstance', () => {
    it('should return the same instance on multiple calls', () => {
      const instance1 = ProductMapper.getInstance();
      const instance2 = ProductMapper.getInstance();

      expect(instance1).toBe(instance2);
    });

    it('should return the same instance as the exported productMapper', () => {
      const instance = ProductMapper.getInstance();

      expect(instance).toBe(productMapper);
    });
  });

  describe('bidirectional mapping', () => {
    it('should maintain data integrity through round-trip conversion', () => {
      const original = new ProductBuilder()
        .withId('test-id')
        .withName('Test Product')
        .withPrice(99.99)
        .withSku('TEST-001')
        .withCategory('Electronics')
        .withStock(10)
        .withDescription('Test description')
        .withImageUrl('https://example.com/image.jpg')
        .withBarcode('1234567890')
        .withEmoji('📱')
        .build();

      const dto = productMapper.toResponseDto(original);
      const restored = productMapper.fromResponseDto(dto);

      expect(restored.id).toBe(original.id);
      expect(restored.name).toBe(original.name);
      expect(restored.price).toBe(original.price);
      expect(restored.sku).toBe(original.sku);
      expect(restored.category).toBe(original.category);
      expect(restored.stock).toBe(original.stock);
      expect(restored.description).toBe(original.description);
      expect(restored.imageUrl).toBe(original.imageUrl);
      expect(restored.barcode).toBe(original.barcode);
      expect(restored.emoji).toBe(original.emoji);
    });
  });
});

// Made with Bob
