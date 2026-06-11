import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CustomerFacade } from './customer.facade';
import { ManageCustomersUseCase } from '@core/application/use-cases/manage-customers.use-case';

describe('CustomerFacade', () => {
  let facade: CustomerFacade;
  let mockCustomersUseCase: {
    customers: ReturnType<typeof signal>;
    loading: ReturnType<typeof signal>;
    error: ReturnType<typeof signal>;
    loadCustomers: ReturnType<typeof vi.fn>;
    createCustomer: ReturnType<typeof vi.fn>;
    updateCustomer: ReturnType<typeof vi.fn>;
    deleteCustomer: ReturnType<typeof vi.fn>;
    searchCustomers: ReturnType<typeof vi.fn>;
    getCustomerById: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockCustomersUseCase = {
      customers: signal([]),
      loading: signal(false),
      error: signal(null),
      loadCustomers: vi.fn().mockResolvedValue([]),
      createCustomer: vi.fn().mockResolvedValue({ id: 'cust-1', name: 'New Customer' }),
      updateCustomer: vi.fn().mockResolvedValue({ id: 'cust-1', name: 'Updated' }),
      deleteCustomer: vi.fn().mockResolvedValue(true),
      searchCustomers: vi.fn().mockResolvedValue(undefined),
      getCustomerById: vi.fn().mockResolvedValue(null),
    };

    TestBed.configureTestingModule({
      providers: [
        CustomerFacade,
        { provide: ManageCustomersUseCase, useValue: mockCustomersUseCase },
      ],
    });

    facade = TestBed.inject(CustomerFacade);
  });

  describe('creation', () => {
    it('should be created', () => {
      expect(facade).toBeTruthy();
    });
  });

  describe('state delegation', () => {
    it('should expose customers from ManageCustomersUseCase', () => {
      expect(facade.customers()).toEqual([]);
    });

    it('should expose loading from ManageCustomersUseCase', () => {
      expect(facade.loading()).toBe(false);
    });

    it('should expose error from ManageCustomersUseCase', () => {
      expect(facade.error()).toBeNull();
    });
  });

  describe('customer CRUD operations', () => {
    it('should delegate loadCustomers to use case', async () => {
      await facade.loadCustomers();
      expect(mockCustomersUseCase.loadCustomers).toHaveBeenCalled();
    });

    it('should delegate createCustomer to use case', async () => {
      const request = {
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-0100',
      };
      await facade.createCustomer(request);
      expect(mockCustomersUseCase.createCustomer).toHaveBeenCalledWith(request);
    });

    it('should delegate createCustomer with optional fields', async () => {
      const request = {
        name: 'Jane Smith',
        email: 'jane@example.com',
        phone: '555-0200',
        address: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        zipCode: '62701',
        country: 'US',
        notes: 'VIP customer',
      };
      await facade.createCustomer(request);
      expect(mockCustomersUseCase.createCustomer).toHaveBeenCalledWith(request);
    });

    it('should delegate updateCustomer to use case', async () => {
      const request = { id: 'cust-1', name: 'Updated Name', email: 'new@example.com' };
      await facade.updateCustomer(request);
      expect(mockCustomersUseCase.updateCustomer).toHaveBeenCalledWith(request);
    });

    it('should delegate deleteCustomer to use case', async () => {
      await facade.deleteCustomer('cust-1');
      expect(mockCustomersUseCase.deleteCustomer).toHaveBeenCalledWith('cust-1');
    });
  });

  describe('search operations', () => {
    it('should delegate searchCustomers to use case', async () => {
      await facade.searchCustomers('john');
      expect(mockCustomersUseCase.searchCustomers).toHaveBeenCalledWith('john');
    });

    it('should delegate searchCustomers with empty query', async () => {
      await facade.searchCustomers('');
      expect(mockCustomersUseCase.searchCustomers).toHaveBeenCalledWith('');
    });
  });

  describe('getCustomerById', () => {
    it('should delegate getCustomerById to use case', async () => {
      const result = await facade.getCustomerById('cust-1');
      expect(mockCustomersUseCase.getCustomerById).toHaveBeenCalledWith('cust-1');
      expect(result).toBeNull();
    });

    it('should return customer when found', async () => {
      const mockCustomer = {
        id: 'cust-1',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '555-0100',
        address: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        zipCode: '62701',
        country: 'US',
        notes: '',
      };
      mockCustomersUseCase.getCustomerById.mockResolvedValue(mockCustomer);

      const result = await facade.getCustomerById('cust-1');
      expect(result).toEqual(mockCustomer);
    });
  });
});
