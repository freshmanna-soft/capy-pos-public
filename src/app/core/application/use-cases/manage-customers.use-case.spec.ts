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
    overrides: Partial<{ id: string; name: string; email: string; phone: string }> = {}
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

    it('mints a loyalty card for every new customer', async () => {
      // The alternative — issuing on request — means the clerk cannot recognise
      // anybody until somebody remembers to press a second button, which is the
      // state this story started from.
      mockRepository.findByEmail.mockResolvedValue(null);
      mockRepository.create.mockImplementation(async (customer: Customer) => customer);

      const result = await useCase.createCustomer(validRequest);

      expect(result!.loyaltyCode).toMatch(/^CAPY-[0-9A-Z]{8}$/);
    });

    it('mints a different card for each customer', async () => {
      mockRepository.findByEmail.mockResolvedValue(null);
      mockRepository.create.mockImplementation(async (customer: Customer) => customer);

      const first = await useCase.createCustomer(validRequest);
      const second = await useCase.createCustomer({ ...validRequest, email: 'other@test.com' });

      expect(first!.loyaltyCode).not.toBe(second!.loyaltyCode);
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
        async (_id: string, data: Partial<Customer>) => data as Customer
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
        async (_id: string, data: Partial<Customer>) => data as Customer
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
        async (_id: string, data: Partial<Customer>) => data as Customer
      );

      await useCase.updateCustomer({ id: 'cust-1', name: 'Updated' });

      const updated = useCase.customers().find((c) => c.id === 'cust-1');
      expect(updated!.name).toBe('Updated');
    });
  });

  describe('issueLoyaltyCode', () => {
    const withoutCard = (): Customer => createMockCustomer();

    const withCard = (): Customer =>
      new Customer({
        id: 'customer-1',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '+1234567890',
        status: CustomerStatus.ACTIVE,
        loyaltyPoints: 100,
        tier: CustomerTier.BRONZE,
        loyaltyCode: 'CAPY-B3KMNPQR',
      });

    it('mints and persists a card for a customer who has none', async () => {
      // The retrofit path: every customer created before #176 has no code, and
      // minting on a list load would be a silent write, so it happens here behind a
      // button instead.
      mockRepository.findById.mockResolvedValue(withoutCard());
      mockRepository.update.mockImplementation(
        async (_id: string, customer: Partial<Customer>) => customer as Customer
      );

      const code = await useCase.issueLoyaltyCode('customer-1');

      expect(code).toMatch(/^CAPY-[0-9A-Z]{8}$/);
      expect(mockRepository.update).toHaveBeenCalledTimes(1);
      const [, persisted] = mockRepository.update.mock.calls[0]!;
      expect((persisted as Customer).loyaltyCode).toBe(code);
    });

    it('returns the existing card rather than minting a second one', async () => {
      // The button that prints the card is next to this one. Re-minting on a double
      // tap would invalidate a card already in somebody's wallet and orphan the
      // printout the first tap produced.
      mockRepository.findById.mockResolvedValue(withCard());

      const code = await useCase.issueLoyaltyCode('customer-1');

      expect(code).toBe('CAPY-B3KMNPQR');
      expect(mockRepository.update).not.toHaveBeenCalled();
    });

    it('is idempotent across repeated calls', async () => {
      const stored = withCard();
      mockRepository.findById.mockResolvedValue(stored);

      const first = await useCase.issueLoyaltyCode('customer-1');
      const second = await useCase.issueLoyaltyCode('customer-1');

      expect(second).toBe(first);
      expect(mockRepository.update).not.toHaveBeenCalled();
    });

    it('refreshes the row already on screen', async () => {
      mockRepository.findAll.mockResolvedValue([withoutCard()]);
      await useCase.loadCustomers();
      expect(useCase.customers()[0]!.loyaltyCode).toBeUndefined();

      mockRepository.findById.mockResolvedValue(withoutCard());
      mockRepository.update.mockImplementation(
        async (_id: string, customer: Partial<Customer>) => customer as Customer
      );

      const code = await useCase.issueLoyaltyCode('customer-1');

      expect(useCase.customers()[0]!.loyaltyCode).toBe(code);
    });

    it('leaves other rows untouched', async () => {
      mockRepository.findAll.mockResolvedValue([
        withoutCard(),
        createMockCustomer({ id: 'other' }),
      ]);
      await useCase.loadCustomers();

      mockRepository.findById.mockResolvedValue(withoutCard());
      mockRepository.update.mockImplementation(
        async (_id: string, customer: Partial<Customer>) => customer as Customer
      );

      await useCase.issueLoyaltyCode('customer-1');

      expect(useCase.customers()[1]!.id).toBe('other');
      expect(useCase.customers()[1]!.loyaltyCode).toBeUndefined();
    });

    it('reports a customer who is not there', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(useCase.issueLoyaltyCode('ghost')).resolves.toBeNull();
      expect(useCase.error()).toBe("Customer with id 'ghost' not found");
      expect(mockRepository.update).not.toHaveBeenCalled();
    });

    it('clears a previous error on a successful issue', async () => {
      mockRepository.findById.mockResolvedValueOnce(null);
      await useCase.issueLoyaltyCode('ghost');
      expect(useCase.error()).not.toBeNull();

      mockRepository.findById.mockResolvedValue(withoutCard());
      mockRepository.update.mockImplementation(
        async (_id: string, customer: Partial<Customer>) => customer as Customer
      );
      await useCase.issueLoyaltyCode('customer-1');

      expect(useCase.error()).toBeNull();
    });

    it('reports a write that fails', async () => {
      mockRepository.findById.mockResolvedValue(withoutCard());
      mockRepository.update.mockRejectedValue(new Error('db closed'));

      await expect(useCase.issueLoyaltyCode('customer-1')).resolves.toBeNull();
      expect(useCase.error()).toBe('db closed');
    });

    it('still says something readable when a write fails oddly', async () => {
      mockRepository.findById.mockResolvedValue(withoutCard());
      mockRepository.update.mockRejectedValue('gone');

      await expect(useCase.issueLoyaltyCode('customer-1')).resolves.toBeNull();
      expect(useCase.error()).toBe('Failed to issue a loyalty code');
    });

    it('answers null when the write comes back without a code', async () => {
      // A repository that drops the field is a bug, but the caller prints whatever
      // it is handed — so it must not be handed a card the database does not have.
      mockRepository.findById.mockResolvedValue(withoutCard());
      mockRepository.update.mockResolvedValue(withoutCard());

      await expect(useCase.issueLoyaltyCode('customer-1')).resolves.toBeNull();
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

  describe('rejections that are not Errors', () => {
    /**
     * A repository can reject with a string, a Dexie event, or an object from a
     * worker's postMessage — anything that crossed a boundary. Every one of these
     * paths reads `error.message`, and the fallback is the difference between a
     * readable banner and the word "undefined" on screen.
     */
    it('still says something readable when a load fails oddly', async () => {
      mockRepository.findAll.mockRejectedValue('connection reset');

      await expect(useCase.loadCustomers()).resolves.toEqual([]);
      expect(useCase.error()).toBe('Failed to load customers');
      expect(useCase.loading()).toBe(false);
    });

    it('still says something readable when a create fails oddly', async () => {
      mockRepository.findByEmail.mockResolvedValue(null);
      mockRepository.create.mockRejectedValue({ code: 'ConstraintError' });

      await expect(
        useCase.createCustomer({
          name: 'Jane',
          email: 'jane@example.com',
          phone: '+1234567890',
        } as CreateCustomerRequest)
      ).resolves.toBeNull();
      expect(useCase.error()).toBe('Failed to create customer');
    });

    it('still says something readable when an update fails oddly', async () => {
      mockRepository.findById.mockResolvedValue(createMockCustomer());
      mockRepository.update.mockRejectedValue('gone');

      await expect(
        useCase.updateCustomer({ id: 'customer-1', name: 'Jane' } as UpdateCustomerRequest)
      ).resolves.toBeNull();
      expect(useCase.error()).toBe('Failed to update customer');
    });

    it('still says something readable when a delete fails oddly', async () => {
      mockRepository.findById.mockResolvedValue(createMockCustomer());
      mockRepository.delete.mockRejectedValue('gone');

      await expect(useCase.deleteCustomer('customer-1')).resolves.toBe(false);
      expect(useCase.error()).toBe('Failed to delete customer');
    });

    it('still says something readable when a search fails oddly', async () => {
      mockRepository.search.mockRejectedValue('index missing');

      await expect(useCase.searchCustomers('jane')).resolves.toEqual([]);
      expect(useCase.error()).toBe('Failed to search customers');
    });

    it('answers null rather than throwing when one customer cannot be read', async () => {
      // The caller here is a detail view; a thrown error would blank the page it is
      // trying to decorate.
      mockRepository.findById.mockRejectedValue(new Error('db closed'));

      await expect(useCase.getCustomerById('customer-1')).resolves.toBeNull();
    });
  });
});
