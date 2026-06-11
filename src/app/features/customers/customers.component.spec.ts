import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomersComponent } from './customers.component';
import {
  ManageCustomersUseCase,
  CustomerSummaryDTO,
} from '@core/application/use-cases/manage-customers.use-case';
import { CustomerStatus } from '@core/domain/entities/customer.entity';
import { signal, computed } from '@angular/core';

describe('CustomersComponent', () => {
  let component: CustomersComponent;
  let fixture: ComponentFixture<CustomersComponent>;
  let mockUseCase: Partial<ManageCustomersUseCase>;

  const mockCustomers: CustomerSummaryDTO[] = [
    {
      id: 'c1',
      name: 'Maria Garcia',
      email: 'maria@example.com',
      phone: '(555) 111-2222',
      status: CustomerStatus.ACTIVE,
      loyaltyPoints: 150,
      tier: 'SILVER',
      totalPurchases: 12,
      createdAt: new Date('2026-01-15'),
    },
    {
      id: 'c2',
      name: 'Carlos Lopez',
      email: 'carlos@example.com',
      phone: '(555) 333-4444',
      status: CustomerStatus.VIP,
      loyaltyPoints: 500,
      tier: 'GOLD',
      totalPurchases: 45,
      createdAt: new Date('2025-06-01'),
    },
    {
      id: 'c3',
      name: 'Ana Martinez',
      email: 'ana@example.com',
      phone: '(555) 555-6666',
      status: CustomerStatus.INACTIVE,
      loyaltyPoints: 25,
      tier: 'BRONZE',
      totalPurchases: 3,
      createdAt: new Date('2026-03-20'),
    },
  ];

  beforeEach(async () => {
    const customersSignal = signal<CustomerSummaryDTO[]>(mockCustomers);
    const loadingSignal = signal<boolean>(false);
    const errorSignal = signal<string | null>(null);
    const selectedSignal = signal<CustomerSummaryDTO | null>(null);

    mockUseCase = {
      customers: computed(() => customersSignal()),
      loading: computed(() => loadingSignal()),
      error: computed(() => errorSignal()),
      selectedCustomer: computed(() => selectedSignal()),
      loadCustomers: vi.fn().mockResolvedValue(mockCustomers),
      createCustomer: vi.fn().mockResolvedValue(mockCustomers[0]),
      updateCustomer: vi.fn().mockResolvedValue(mockCustomers[0]),
      deleteCustomer: vi.fn().mockResolvedValue(true),
      searchCustomers: vi.fn().mockResolvedValue(mockCustomers),
      getCustomerById: vi.fn().mockResolvedValue(mockCustomers[0]),
      selectCustomer: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [CustomersComponent],
      providers: [{ provide: ManageCustomersUseCase, useValue: mockUseCase }],
    }).compileComponents();

    fixture = TestBed.createComponent(CustomersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create the component', () => {
    expect(component).toBeTruthy();
  });

  it('should call loadCustomers on init', () => {
    expect(mockUseCase.loadCustomers).toHaveBeenCalledTimes(1);
  });

  describe('Filtering', () => {
    it('should display all customers when no filter is applied', () => {
      expect(component.filteredCustomers().length).toBe(3);
    });

    it('should filter customers by name search', () => {
      component.searchQuery.set('maria');
      expect(component.filteredCustomers().length).toBe(1);
      expect(component.filteredCustomers()[0].name).toBe('Maria Garcia');
    });

    it('should filter customers by email search', () => {
      component.searchQuery.set('carlos@');
      expect(component.filteredCustomers().length).toBe(1);
      expect(component.filteredCustomers()[0].name).toBe('Carlos Lopez');
    });

    it('should filter customers by phone search', () => {
      component.searchQuery.set('555-6666');
      expect(component.filteredCustomers().length).toBe(1);
      expect(component.filteredCustomers()[0].name).toBe('Ana Martinez');
    });

    it('should filter customers by status', () => {
      component.statusFilter.set(CustomerStatus.ACTIVE);
      expect(component.filteredCustomers().length).toBe(1);
      expect(component.filteredCustomers()[0].name).toBe('Maria Garcia');
    });

    it('should filter VIP customers by status', () => {
      component.statusFilter.set(CustomerStatus.VIP);
      expect(component.filteredCustomers().length).toBe(1);
      expect(component.filteredCustomers()[0].name).toBe('Carlos Lopez');
    });

    it('should combine search and status filters', () => {
      component.searchQuery.set('a');
      component.statusFilter.set(CustomerStatus.ACTIVE);
      expect(component.filteredCustomers().length).toBe(1);
      expect(component.filteredCustomers()[0].name).toBe('Maria Garcia');
    });

    it('should return empty when no match found', () => {
      component.searchQuery.set('nonexistent');
      expect(component.filteredCustomers().length).toBe(0);
    });
  });

  describe('Computed Values', () => {
    it('should compute active count correctly', () => {
      expect(component.activeCount()).toBe(1);
    });

    it('should compute VIP count correctly', () => {
      expect(component.vipCount()).toBe(1);
    });

    it('should compute total loyalty points correctly', () => {
      expect(component.totalLoyaltyPoints()).toBe(675); // 150 + 500 + 25
    });
  });

  describe('Helper Methods', () => {
    it('should generate initials from full name', () => {
      expect(component.getInitials('Maria Garcia')).toBe('MG');
    });

    it('should generate initials from single name', () => {
      expect(component.getInitials('Maria')).toBe('M');
    });

    it('should limit initials to 2 characters', () => {
      expect(component.getInitials('Maria Elena Garcia Lopez')).toBe('ME');
    });
  });

  describe('Form Operations', () => {
    it('should open create form with empty data', () => {
      component.openCreateForm();
      expect(component.formMode()).toBe('create');
      expect(component.editingCustomerId()).toBeNull();
      expect(component.formData().name).toBe('');
      expect(component.formData().email).toBe('');
      expect(component.formData().phone).toBe('');
    });

    it('should open edit form with customer data', async () => {
      await component.openEditForm(mockCustomers[0]);
      expect(component.formMode()).toBe('edit');
      expect(component.editingCustomerId()).toBe('c1');
      expect(component.formData().name).toBe('Maria Garcia');
      expect(component.formData().email).toBe('maria@example.com');
      expect(component.formData().phone).toBe('(555) 111-2222');
    });

    it('should close form and reset state', () => {
      component.openCreateForm();
      component.closeForm();
      expect(component.formMode()).toBe('closed');
      expect(component.editingCustomerId()).toBeNull();
      expect(component.formData().name).toBe('');
    });

    it('should update form field and clear error', () => {
      component.formErrors.set({ name: 'Required' });
      component.updateFormField('name', 'New Name');
      expect(component.formData().name).toBe('New Name');
      expect(component.formErrors()['name']).toBeUndefined();
    });

    it('should validate required fields on save', async () => {
      component.openCreateForm();
      await component.saveCustomer();
      expect(component.formErrors()['name']).toBe('Customer name is required');
      expect(component.formErrors()['email']).toBe('Email is required');
      expect(component.formErrors()['phone']).toBe('Phone number is required');
    });

    it('should validate email format', async () => {
      component.openCreateForm();
      component.updateFormField('name', 'Test');
      component.updateFormField('email', 'invalid-email');
      component.updateFormField('phone', '555-1234');
      await component.saveCustomer();
      expect(component.formErrors()['email']).toBe('Please enter a valid email address');
    });

    it('should accept valid email format', async () => {
      component.openCreateForm();
      component.updateFormField('name', 'Test Customer');
      component.updateFormField('email', 'test@example.com');
      component.updateFormField('phone', '(555) 123-4567');

      await component.saveCustomer();

      expect(component.formErrors()['email']).toBeUndefined();
      expect(mockUseCase.createCustomer).toHaveBeenCalledTimes(1);
    });

    it('should call createCustomer on valid create form', async () => {
      component.openCreateForm();
      component.updateFormField('name', 'New Customer');
      component.updateFormField('email', 'new@example.com');
      component.updateFormField('phone', '(555) 999-8888');

      await component.saveCustomer();

      expect(mockUseCase.createCustomer).toHaveBeenCalledTimes(1);
      expect(component.formMode()).toBe('closed');
    });

    it('should call updateCustomer on valid edit form', async () => {
      await component.openEditForm(mockCustomers[0]);
      component.updateFormField('name', 'Updated Maria');

      await component.saveCustomer();

      expect(mockUseCase.updateCustomer).toHaveBeenCalledTimes(1);
      expect(component.formMode()).toBe('closed');
    });

    it('should not call updateCustomer if no editing id', async () => {
      component.formMode.set('edit');
      component.editingCustomerId.set(null);
      component.updateFormField('name', 'Test');
      component.updateFormField('email', 'test@test.com');
      component.updateFormField('phone', '555');

      await component.saveCustomer();

      expect(mockUseCase.updateCustomer).not.toHaveBeenCalled();
    });
  });

  describe('Delete Operations', () => {
    it('should open delete confirmation', () => {
      component.requestDelete('c1');
      expect(component.deleteConfirmId()).toBe('c1');
    });

    it('should cancel delete', () => {
      component.requestDelete('c1');
      component.cancelDelete();
      expect(component.deleteConfirmId()).toBeNull();
    });

    it('should confirm delete and call use case', async () => {
      component.requestDelete('c1');
      await component.confirmDelete();
      expect(mockUseCase.deleteCustomer).toHaveBeenCalledWith('c1');
      expect(component.deleteConfirmId()).toBeNull();
    });

    it('should not call delete if no id set', async () => {
      await component.confirmDelete();
      expect(mockUseCase.deleteCustomer).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should call loadCustomers on dismissError', () => {
      component.dismissError();
      // Called once on init + once on dismiss
      expect(mockUseCase.loadCustomers).toHaveBeenCalledTimes(2);
    });
  });
});
