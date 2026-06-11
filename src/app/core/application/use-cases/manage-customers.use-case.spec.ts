import { TestBed } from '@angular/core/testing';
import { vi, type MockedObject } from 'vitest';
import {
  ManageCustomersUseCase,
  CreateCustomerRequest,
  UpdateCustomerRequest,
} from './manage-customers.use-case';
import { CUSTOMER_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { ICustomerRepository } from '@core/domain/interfaces/customer.repository.interface';
import { Customer, CustomerStatus, CustomerTier } from '@core/domain/entities/customer.entity';

describe('ManageCustomersUseCase', () => {
  let useCase: ManageCustomersUseCase;
  let mockRepository: MockedObject<ICustomerRepository>;

  const createMockCustomer = (
    overrides: Partial<{ id: string; name: string; email: string; phone: string }> = {},
  ): Customer => {
    return new Customer({
      id: overrides.id ?? 'customer-1',
      name: overrides.name ?? 'John Doe',
      email: overrides.email ?? 'john@example.com',
      phone: overrides.phone ?? '+1234567890',
      status: CustomerStatus.ACTIVE,
      loyaltyPoints: 100,
      tier: CustomerTier.BRONZE,
      country: 'US',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
    });
  };

  beforeEach(() => {
    mockRepository = {
      findAll: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
      count: vi.fn(),
      bulkCreate: vi.fn(),
      bulkUpdate: vi.fn(),
      findByStatus: vi.fn(),
      findByTier: vi.fn(),
      findByEmail: vi.fn(),
      findByPhone: vi.fn(),
      search: vi.fn(),
      findVIPCustomers: vi.fn(),
      findByMinLoyaltyPoints: vi.fn(),
      getTopCustomers: vi.fn(),
      updateLoyaltyPoints: vi.fn(),
      updateStatus: vi.fn(),
    } as unknown as MockedObject<ICustomerRepository>;

    TestBed.configureTestingModule({
      providers: [
        ManageCustomersUseCase,
        { provide: CUSTOMER_REPOSITORY, useValue: mockRepository },
      ],
    });

    useCase = TestBed.inject(ManageCustomersUseCase);
  });

  describe('initial state', () => {
    it('should have empty customers list', () => {
      expect(useCase.customers()).toEqual([]);
    });

    it('should not be loading', () => {
      expect(useCase.loading()).toBe(false);
    });

    it('should have no error', () => {
      expect(useCase.error()).toBeNull();
    });

    it('should have no selected customer', () => {
      expect(useCase.selectedCustomer()).toBeNull();
    });
  });

  describe('loadCustomers', () => {
    it('should load all customers from repository', async () => {
      const customers = [
        createMockCustomer({ id: '1', name: 'Alice', email: 'alice@test.com' }),
        createMockCustomer({ id: '2', name: 'Bob', email: 'bob@test.com' }),
      ];
      mockRepository.findAll.mockResolvedValue(customers);

      const result = await useCase.loadCustomers();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Alice');
      expect(result[1].name).toBe('Bob');
      expect(useCase.customers()).toHaveLength(2);
    });

    it('should set loading state during operation', async () => {
      mockRepository.findAll.mockImplementation(async () => {
        expect(useCase.loading()).toBe(true);
        return [];
      });

      await useCase.loadCustomers();
      expect(useCase.loading()).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      mockRepository.findAll.mockRejectedValue(new Error('Database error'));

      const result = await useCase.loadCustomers();

      expect(result).toEqual([]);
      expect(useCase.error()).toBe('Database error');
      expect(useCase.loading()).toBe(false);
    });

    it('should clear previous error on new load', async () => {
      mockRepository.findAll.mockRejectedValueOnce(new Error('First error'));
      await useCase.loadCustomers();
      expect(useCase.error()).toBe('First error');

      mockRepository.findAll.mockResolvedValueOnce([]);
      await useCase.loadCustomers();
      expect(useCase.error()).toBeNull();
    });
  });

  describe('createCustomer', () => {
    const validRequest: CreateCustomerRequest = {
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+1987654321',
      address: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      zipCode: '62701',
      country: 'US',
    };

    it('should create a new customer successfully', async () => {
      mockRepository.findByEmail.mockResolvedValue(null);
      mockRepository.create.mockImplementation(async (customer: Customer) => customer);

      const result = await useCase.createCustomer(validRequest);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Jane Smith');
      expect(result!.email).toBe('jane@example.com');
      expect(result!.phone).toBe('+1987654321');
      expect(result!.status).toBe(CustomerStatus.ACTIVE);
      expect(useCase.customers()).toHaveLength(1);
    });

    it('should reject duplicate email', async () => {
      const existingCustomer = createMockCustomer({ email: 'jane@example.com' });
      mockRepository.findByEmail.mockResolvedValue(existingCustomer);

      const result = await useCase.createCustomer(validRequest);

      expect(result).toBeNull();
      expect(useCase.error()).toBe("Customer with email 'jane@example.com' already exists");
      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('should set loading state during creation', async () => {
      mockRepository.findByEmail.mockResolvedValue(null);
      mockRepository.create.mockImplementation(async (customer: Customer) => {
        expect(useCase.loading()).toBe(true);
        return customer;
      });

      await useCase.createCustomer(validRequest);
      expect(useCase.loading()).toBe(false);
    });

    it('should handle repository errors', async () => {
      mockRepository.findByEmail.mockResolvedValue(null);
      mockRepository.create.mockRejectedValue(new Error('Create failed'));

      const result = await useCase.createCustomer(validRequest);

      expect(result).toBeNull();
      expect(useCase.error()).toBe('Create failed');
    });

    it('should add created customer to the list', async () => {
      mockRepository.findByEmail.mockResolvedValue(null);
      mockRepository.create.mockImplementation(async (customer: Customer) => customer);

      await useCase.createCustomer(validRequest);
      await useCase.createCustomer({ ...validRequest, email: 'other@test.com', name: 'Other' });

      expect(useCase.customers()).toHaveLength(2);
    });
  });

  describe('updateCustomer', () => {
    const existingCustomer = createMockCustomer({
      id: 'cust-1',
      name: 'Original Name',
      email: 'original@test.com',
    });

    it('should update an existing customer', async () => {
      mockRepository.findById.mockResolvedValue(existingCustomer);
      mockRepository.update.mockImplementation(
        async (_id: string, data: Partial<Customer>) => data as Customer,
      );

      const request: UpdateCustomerRequest = {
        id: 'cust-1',
        name: 'Updated Name',
      };

      const result = await useCase.updateCustomer(request);

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Updated Name');
    });

    it('should return null if customer not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      const result = await useCase.updateCustomer({ id: 'nonexistent', name: 'Test' });

      expect(result).toBeNull();
      expect(useCase.error()).toBe("Customer with id 'nonexistent' not found");
    });

    it('should check email uniqueness on email change', async () => {
      mockRepository.findById.mockResolvedValue(existingCustomer);
      const otherCustomer = createMockCustomer({ id: 'cust-2', email: 'taken@test.com' });
      mockRepository.findByEmail.mockResolvedValue(otherCustomer);

      const result = await useCase.updateCustomer({ id: 'cust-1', email: 'taken@test.com' });

      expect(result).toBeNull();
      expect(useCase.error()).toBe("Customer with email 'taken@test.com' already exists");
    });

    it('should not check email uniqueness if email unchanged', async () => {
      mockRepository.findById.mockResolvedValue(existingCustomer);
      mockRepository.update.mockImplementation(
        async (_id: string, data: Partial<Customer>) => data as Customer,
      );

      await useCase.updateCustomer({ id: 'cust-1', name: 'New Name' });

      expect(mockRepository.findByEmail).not.toHaveBeenCalled();
    });

    it('should update the customer in the list', async () => {
      // Pre-load customers
      mockRepository.findAll.mockResolvedValue([existingCustomer]);
      await useCase.loadCustomers();

      mockRepository.findById.mockResolvedValue(existingCustomer);
      mockRepository.update.mockImplementation(
        async (_id: string, data: Partial<Customer>) => data as Customer,
      );

      await useCase.updateCustomer({ id: 'cust-1', name: 'Updated' });

      const updated = useCase.customers().find((c) => c.id === 'cust-1');
      expect(updated!.name).toBe('Updated');
    });
  });

  describe('deleteCustomer', () => {
    it('should delete a customer successfully', async () => {
      const customer = createMockCustomer({ id: 'del-1' });
      mockRepository.findAll.mockResolvedValue([customer]);
      await useCase.loadCustomers();

      mockRepository.delete.mockResolvedValue(undefined);

      const result = await useCase.deleteCustomer('del-1');

      expect(result).toBe(true);
      expect(useCase.customers()).toHaveLength(0);
    });

    it('should handle delete errors', async () => {
      mockRepository.delete.mockRejectedValue(new Error('Delete failed'));

      const result = await useCase.deleteCustomer('del-1');

      expect(result).toBe(false);
      expect(useCase.error()).toBe('Delete failed');
    });

    it('should clear selected customer if deleted', async () => {
      const customer = createMockCustomer({ id: 'sel-1' });
      mockRepository.findAll.mockResolvedValue([customer]);
      await useCase.loadCustomers();

      useCase.selectCustomer(useCase.customers()[0]);
      expect(useCase.selectedCustomer()).not.toBeNull();

      mockRepository.delete.mockResolvedValue(undefined);
      await useCase.deleteCustomer('sel-1');

      expect(useCase.selectedCustomer()).toBeNull();
    });
  });

  describe('searchCustomers', () => {
    it('should search customers by query', async () => {
      const results = [createMockCustomer({ id: '1', name: 'Alice' })];
      mockRepository.search.mockResolvedValue(results);

      const found = await useCase.searchCustomers('Alice');

      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('Alice');
      expect(mockRepository.search).toHaveBeenCalledWith('Alice');
    });

    it('should load all customers when query is empty', async () => {
      mockRepository.findAll.mockResolvedValue([]);

      await useCase.searchCustomers('   ');

      expect(mockRepository.findAll).toHaveBeenCalled();
      expect(mockRepository.search).not.toHaveBeenCalled();
    });

    it('should handle search errors', async () => {
      mockRepository.search.mockRejectedValue(new Error('Search failed'));

      const result = await useCase.searchCustomers('test');

      expect(result).toEqual([]);
      expect(useCase.error()).toBe('Search failed');
    });
  });

  describe('selectCustomer', () => {
    it('should set selected customer', () => {
      const summary = {
        id: '1',
        name: 'Test',
        email: 'test@test.com',
        phone: '123',
        status: CustomerStatus.ACTIVE,
        loyaltyPoints: 0,
        tier: 'BRONZE',
        totalPurchases: 0,
        createdAt: new Date(),
      };

      useCase.selectCustomer(summary);
      expect(useCase.selectedCustomer()).toEqual(summary);
    });

    it('should clear selected customer with null', () => {
      useCase.selectCustomer(null);
      expect(useCase.selectedCustomer()).toBeNull();
    });
  });
});
