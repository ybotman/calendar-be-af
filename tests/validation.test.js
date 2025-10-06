const { validateCalendar, validateEvent } = require('../src/utils/validation');

describe('Validation Tests', () => {
    describe('Calendar Validation', () => {
        test('should validate valid calendar data', () => {
            const validCalendar = {
                name: 'Test Calendar',
                description: 'A test calendar',
                color: '#3498db',
                isDefault: false
            };

            const { error, value } = validateCalendar(validCalendar);
            expect(error).toBeUndefined();
            expect(value.name).toBe('Test Calendar');
        });

        test('should reject calendar with invalid name', () => {
            const invalidCalendar = {
                name: '',
                description: 'A test calendar'
            };

            const { error } = validateCalendar(invalidCalendar);
            expect(error).toBeDefined();
            expect(error.details[0].path).toContain('name');
        });

        test('should reject calendar with invalid color format', () => {
            const invalidCalendar = {
                name: 'Test Calendar',
                color: 'invalid-color'
            };

            const { error } = validateCalendar(invalidCalendar);
            expect(error).toBeDefined();
        });
    });

    describe('Event Validation', () => {
        test('should validate valid event data', () => {
            const validEvent = {
                title: 'Test Event',
                description: 'A test event',
                startTime: '2025-10-06T10:00:00Z',
                endTime: '2025-10-06T11:00:00Z',
                isAllDay: false,
                location: 'Test Location',
                attendees: ['test@example.com']
            };

            const { error, value } = validateEvent(validEvent);
            expect(error).toBeUndefined();
            expect(value.title).toBe('Test Event');
        });

        test('should reject event with end time before start time', () => {
            const invalidEvent = {
                title: 'Test Event',
                startTime: '2025-10-06T11:00:00Z',
                endTime: '2025-10-06T10:00:00Z'
            };

            const { error } = validateEvent(invalidEvent);
            expect(error).toBeDefined();
        });

        test('should reject event with invalid email in attendees', () => {
            const invalidEvent = {
                title: 'Test Event',
                startTime: '2025-10-06T10:00:00Z',
                endTime: '2025-10-06T11:00:00Z',
                attendees: ['invalid-email']
            };

            const { error } = validateEvent(invalidEvent);
            expect(error).toBeDefined();
        });
    });
});