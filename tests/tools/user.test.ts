import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { ResyClient } from '../../src/client.js';
import { registerUserTools } from '../../src/tools/user.js';
import { createTestHarness } from '../helpers.js';

const mockRequest = vi.fn();
const mockClient = { request: mockRequest } as unknown as ResyClient;

let harness: Awaited<ReturnType<typeof createTestHarness>>;

beforeEach(() => vi.clearAllMocks());
afterAll(async () => { if (harness) await harness.close(); });

describe('user tools', () => {
  it('setup', async () => {
    harness = await createTestHarness((server) => registerUserTools(server, mockClient));
  });

  describe('resy_get_profile', () => {
    it('calls GET /2/user and returns a sanitised profile', async () => {
      mockRequest.mockResolvedValue({
        first_name: 'Chris',
        last_name: 'Chall',
        em_address: 'chris@example.com',
        mobile_number: '+15551234567',
        num_bookings: 42,
        date_created: '2020-01-15',
        resy_select: false,
        profile_image_url: 'https://...',
        payment_methods: [{ id: 99, brand: 'visa' }], // should be stripped
      });

      const result = await harness.callTool('resy_get_profile');

      expect(mockRequest).toHaveBeenCalledWith('GET', '/2/user');
      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('"first_name": "Chris"');
      expect(text).toContain('"email": "chris@example.com"');
      expect(text).toContain('"phone": "+15551234567"');
      expect(text).not.toContain('payment_methods');
    });
  });

  describe('resy_list_payment_methods', () => {
    it('calls GET /2/user and returns only payment-method fields', async () => {
      mockRequest.mockResolvedValue({
        first_name: 'Chris',
        em_address: 'chris@example.com',
        payment_methods: [
          { id: 55, brand: 'visa', last_four: '4242', exp_month: 12, exp_year: 2030, is_default: true },
          { id: 77, brand: 'amex', display_number: '1001', exp_month: 3, exp_year: 2029 },
        ],
      });

      const result = await harness.callTool('resy_list_payment_methods');

      expect(mockRequest).toHaveBeenCalledWith('GET', '/2/user');
      expect(result.isError).toBeFalsy();
      const text = (result.content[0] as { text: string }).text;
      const parsed = JSON.parse(text);
      expect(parsed).toHaveLength(2);
      expect(parsed[0]).toEqual({
        id: 55, brand: 'visa', last_four: '4242', exp_month: 12, exp_year: 2030, is_default: true,
      });
      expect(parsed[1]).toEqual({
        id: 77, brand: 'amex', last_four: '1001', exp_month: 3, exp_year: 2029, is_default: false,
      });
      // Should not leak other user fields
      expect(text).not.toContain('chris@example.com');
      expect(text).not.toContain('first_name');
    });

    it('returns an empty array when user has no payment methods', async () => {
      mockRequest.mockResolvedValue({ first_name: 'Chris' });
      const result = await harness.callTool('resy_list_payment_methods');
      const text = (result.content[0] as { text: string }).text;
      expect(JSON.parse(text)).toEqual([]);
    });
  });
});
