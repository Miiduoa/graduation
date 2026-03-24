/* eslint-disable */
import {
  setDataSource,
  getDataSource,
  hasDataSource,
  withDataSource,
  DataSource,
} from '../../data/source';

describe('DataSource', () => {
  const createMockDataSource = (): DataSource => ({
    listAnnouncements: jest.fn().mockResolvedValue([]),
    getAnnouncement: jest.fn().mockResolvedValue(null),
    listEvents: jest.fn().mockResolvedValue([]),
    getEvent: jest.fn().mockResolvedValue(null),
    registerEvent: jest.fn().mockResolvedValue(undefined),
    unregisterEvent: jest.fn().mockResolvedValue(undefined),
    listPois: jest.fn().mockResolvedValue([]),
    getPoi: jest.fn().mockResolvedValue(null),
    listMenus: jest.fn().mockResolvedValue([]),
    getMenuItem: jest.fn().mockResolvedValue(null),
    rateMenuItem: jest.fn().mockResolvedValue(undefined),
    getUser: jest.fn().mockResolvedValue(null),
    updateUser: jest.fn().mockResolvedValue({}),
    getUserByEmail: jest.fn().mockResolvedValue(null),
    listCourses: jest.fn().mockResolvedValue([]),
    getCourse: jest.fn().mockResolvedValue(null),
    searchCourses: jest.fn().mockResolvedValue([]),
    listEnrollments: jest.fn().mockResolvedValue([]),
    enrollCourse: jest.fn().mockResolvedValue({}),
    dropCourse: jest.fn().mockResolvedValue(undefined),
    listGrades: jest.fn().mockResolvedValue([]),
    getGPA: jest.fn().mockResolvedValue({ gpa: 0, totalCredits: 0, totalPoints: 0 }),
    listGroups: jest.fn().mockResolvedValue([]),
    getGroup: jest.fn().mockResolvedValue(null),
    createGroup: jest.fn().mockResolvedValue({}),
    updateGroup: jest.fn().mockResolvedValue({}),
    deleteGroup: jest.fn().mockResolvedValue(undefined),
    joinGroup: jest.fn().mockResolvedValue({}),
    leaveGroup: jest.fn().mockResolvedValue(undefined),
    listGroupMembers: jest.fn().mockResolvedValue([]),
    updateMemberRole: jest.fn().mockResolvedValue(undefined),
    removeMember: jest.fn().mockResolvedValue(undefined),
    listGroupPosts: jest.fn().mockResolvedValue([]),
    getGroupPost: jest.fn().mockResolvedValue(null),
    createGroupPost: jest.fn().mockResolvedValue({}),
    updateGroupPost: jest.fn().mockResolvedValue({}),
    deleteGroupPost: jest.fn().mockResolvedValue(undefined),
    likePost: jest.fn().mockResolvedValue(undefined),
    unlikePost: jest.fn().mockResolvedValue(undefined),
    listComments: jest.fn().mockResolvedValue([]),
    createComment: jest.fn().mockResolvedValue({}),
    deleteComment: jest.fn().mockResolvedValue(undefined),
    listAssignments: jest.fn().mockResolvedValue([]),
    getAssignment: jest.fn().mockResolvedValue(null),
    createAssignment: jest.fn().mockResolvedValue({}),
    updateAssignment: jest.fn().mockResolvedValue({}),
    deleteAssignment: jest.fn().mockResolvedValue(undefined),
    listSubmissions: jest.fn().mockResolvedValue([]),
    getSubmission: jest.fn().mockResolvedValue(null),
    submitAssignment: jest.fn().mockResolvedValue({}),
    gradeSubmission: jest.fn().mockResolvedValue({}),
    listConversations: jest.fn().mockResolvedValue([]),
    getConversation: jest.fn().mockResolvedValue(null),
    createConversation: jest.fn().mockResolvedValue({}),
    listMessages: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn().mockResolvedValue({}),
    markMessageRead: jest.fn().mockResolvedValue(undefined),
    listLostFoundItems: jest.fn().mockResolvedValue([]),
    getLostFoundItem: jest.fn().mockResolvedValue(null),
    createLostFoundItem: jest.fn().mockResolvedValue({}),
    updateLostFoundItem: jest.fn().mockResolvedValue({}),
    resolveLostFoundItem: jest.fn().mockResolvedValue(undefined),
    searchBooks: jest.fn().mockResolvedValue([]),
    getBook: jest.fn().mockResolvedValue(null),
    listLoans: jest.fn().mockResolvedValue([]),
    borrowBook: jest.fn().mockResolvedValue({}),
    returnBook: jest.fn().mockResolvedValue(undefined),
    renewBook: jest.fn().mockResolvedValue({}),
    listSeats: jest.fn().mockResolvedValue([]),
    listSeatReservations: jest.fn().mockResolvedValue([]),
    reserveSeat: jest.fn().mockResolvedValue({}),
    cancelSeatReservation: jest.fn().mockResolvedValue(undefined),
    listBusRoutes: jest.fn().mockResolvedValue([]),
    getBusRoute: jest.fn().mockResolvedValue(null),
    getBusArrivals: jest.fn().mockResolvedValue([]),
    listNotifications: jest.fn().mockResolvedValue([]),
    markNotificationRead: jest.fn().mockResolvedValue(undefined),
    markAllNotificationsRead: jest.fn().mockResolvedValue(undefined),
    deleteNotification: jest.fn().mockResolvedValue(undefined),
    listCalendarEvents: jest.fn().mockResolvedValue([]),
    createCalendarEvent: jest.fn().mockResolvedValue({}),
    updateCalendarEvent: jest.fn().mockResolvedValue({}),
    deleteCalendarEvent: jest.fn().mockResolvedValue(undefined),
    syncCoursesToCalendar: jest.fn().mockResolvedValue(undefined),
    listOrders: jest.fn().mockResolvedValue([]),
    getOrder: jest.fn().mockResolvedValue(null),
    createOrder: jest.fn().mockResolvedValue({}),
    updateOrderStatus: jest.fn().mockResolvedValue({}),
    cancelOrder: jest.fn().mockResolvedValue(undefined),
    listTransactions: jest.fn().mockResolvedValue([]),
    processTopup: jest.fn().mockResolvedValue({ success: true }),
    processPayment: jest.fn().mockResolvedValue({ success: true }),
    listAchievements: jest.fn().mockResolvedValue([]),
    getUserAchievements: jest.fn().mockResolvedValue([]),
    updateAchievementProgress: jest.fn().mockResolvedValue({}),
    getDormitoryInfo: jest.fn().mockResolvedValue(null),
    listRepairRequests: jest.fn().mockResolvedValue([]),
    createRepairRequest: jest.fn().mockResolvedValue({}),
    updateRepairRequest: jest.fn().mockResolvedValue({}),
    cancelRepairRequest: jest.fn().mockResolvedValue(undefined),
    listDormPackages: jest.fn().mockResolvedValue([]),
    confirmPackagePickup: jest.fn().mockResolvedValue(undefined),
    listWashingMachines: jest.fn().mockResolvedValue([]),
    listWashingReservations: jest.fn().mockResolvedValue([]),
    reserveWashingMachine: jest.fn().mockResolvedValue({}),
    cancelWashingReservation: jest.fn().mockResolvedValue(undefined),
    listDormAnnouncements: jest.fn().mockResolvedValue([]),
    listPrinters: jest.fn().mockResolvedValue([]),
    getPrinter: jest.fn().mockResolvedValue(null),
    listPrintJobs: jest.fn().mockResolvedValue([]),
    createPrintJob: jest.fn().mockResolvedValue({}),
    cancelPrintJob: jest.fn().mockResolvedValue(undefined),
    listHealthAppointments: jest.fn().mockResolvedValue([]),
    createHealthAppointment: jest.fn().mockResolvedValue({}),
    cancelHealthAppointment: jest.fn().mockResolvedValue(undefined),
    listHealthRecords: jest.fn().mockResolvedValue([]),
    listHealthTimeSlots: jest.fn().mockResolvedValue([]),
  });

  describe('setDataSource and getDataSource', () => {
    it('should set and get data source', () => {
      const mockDs = createMockDataSource();
      setDataSource(mockDs);
      
      const ds = getDataSource();
      expect(ds).toBe(mockDs);
    });

    it('should throw error when getting unset data source', () => {
      setDataSource(null as unknown as DataSource);
      
      expect(() => getDataSource()).toThrow(
        'DataSource not set. Call setDataSource() in App.tsx.'
      );
    });
  });

  describe('hasDataSource', () => {
    it('should return true when data source is set', () => {
      const mockDs = createMockDataSource();
      setDataSource(mockDs);
      
      expect(hasDataSource()).toBe(true);
    });

    it('should return false when data source is not set', () => {
      setDataSource(null as unknown as DataSource);
      
      expect(hasDataSource()).toBe(false);
    });
  });

  describe('withDataSource', () => {
    beforeEach(() => {
      const mockDs = createMockDataSource();
      setDataSource(mockDs);
    });

    it('should execute operation with data source', async () => {
      const mockAnnouncements = [{ id: '1', title: 'Test' }];
      const mockDs = getDataSource();
      (mockDs.listAnnouncements as jest.Mock).mockResolvedValue(mockAnnouncements);

      const result = await withDataSource((ds) => ds.listAnnouncements());

      expect(result).toBe(mockAnnouncements);
    });

    it('should return fallback on error', async () => {
      const mockDs = getDataSource();
      (mockDs.listAnnouncements as jest.Mock).mockRejectedValue(new Error('Network error'));

      const fallback = [{ id: 'fallback', title: 'Fallback' }];
      const result = await withDataSource((ds) => ds.listAnnouncements(), fallback);

      expect(result).toBe(fallback);
    });

    it('should throw error when no fallback provided', async () => {
      const mockDs = getDataSource();
      (mockDs.listAnnouncements as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(withDataSource((ds) => ds.listAnnouncements())).rejects.toThrow(
        'Network error'
      );
    });

    it('should throw error when data source is not set and no fallback', async () => {
      setDataSource(null as unknown as DataSource);

      await expect(
        withDataSource((ds) => ds.listAnnouncements())
      ).rejects.toThrow();
    });

    it('should return fallback when data source is not set', async () => {
      setDataSource(null as unknown as DataSource);

      const fallback = [{ id: 'fallback' }];
      const result = await withDataSource((ds) => ds.listAnnouncements(), fallback);

      expect(result).toBe(fallback);
    });
  });

  describe('DataSource methods', () => {
    let mockDs: DataSource;

    beforeEach(() => {
      mockDs = createMockDataSource();
      setDataSource(mockDs);
    });

    describe('Announcements', () => {
      it('should list announcements', async () => {
        const mockData = [
          { id: '1', title: 'Announcement 1' },
          { id: '2', title: 'Announcement 2' },
        ];
        (mockDs.listAnnouncements as jest.Mock).mockResolvedValue(mockData);

        const ds = getDataSource();
        const result = await ds.listAnnouncements('school-1');

        expect(mockDs.listAnnouncements).toHaveBeenCalledWith('school-1');
        expect(result).toEqual(mockData);
      });

      it('should get single announcement', async () => {
        const mockData = { id: '1', title: 'Test Announcement' };
        (mockDs.getAnnouncement as jest.Mock).mockResolvedValue(mockData);

        const ds = getDataSource();
        const result = await ds.getAnnouncement('1');

        expect(mockDs.getAnnouncement).toHaveBeenCalledWith('1');
        expect(result).toEqual(mockData);
      });
    });

    describe('Events', () => {
      it('should list events', async () => {
        const mockData = [{ id: 'event-1', title: 'Event' }];
        (mockDs.listEvents as jest.Mock).mockResolvedValue(mockData);

        const ds = getDataSource();
        const result = await ds.listEvents('school-1', { limit: 10 });

        expect(mockDs.listEvents).toHaveBeenCalledWith('school-1', { limit: 10 });
        expect(result).toEqual(mockData);
      });

      it('should register for event', async () => {
        const ds = getDataSource();
        await ds.registerEvent('event-1', 'user-1');

        expect(mockDs.registerEvent).toHaveBeenCalledWith('event-1', 'user-1');
      });

      it('should unregister from event', async () => {
        const ds = getDataSource();
        await ds.unregisterEvent('event-1', 'user-1');

        expect(mockDs.unregisterEvent).toHaveBeenCalledWith('event-1', 'user-1');
      });
    });

    describe('Groups', () => {
      it('should create group', async () => {
        const newGroup = { name: 'New Group', schoolId: 'school-1' };
        const createdGroup = { id: 'group-1', ...newGroup, createdAt: new Date(), memberCount: 1 };
        (mockDs.createGroup as jest.Mock).mockResolvedValue(createdGroup);

        const ds = getDataSource();
        const result = await ds.createGroup(newGroup as any);

        expect(mockDs.createGroup).toHaveBeenCalledWith(newGroup);
        expect(result).toEqual(createdGroup);
      });

      it('should join group with join code', async () => {
        const member = { userId: 'user-1', role: 'member' };
        (mockDs.joinGroup as jest.Mock).mockResolvedValue(member);

        const ds = getDataSource();
        await ds.joinGroup('group-1', 'user-1', 'ABC123');

        expect(mockDs.joinGroup).toHaveBeenCalledWith('group-1', 'user-1', 'ABC123');
      });
    });

    describe('Payments', () => {
      it('should process topup', async () => {
        const topupResult = { success: true, newBalance: 1000, transactionId: 'txn-1' };
        (mockDs.processTopup as jest.Mock).mockResolvedValue(topupResult);

        const ds = getDataSource();
        const result = await ds.processTopup({
          userId: 'user-1',
          amount: 500,
          paymentMethod: 'credit_card',
        });

        expect(result.success).toBe(true);
        expect(result.newBalance).toBe(1000);
      });

      it('should process payment', async () => {
        const paymentResult = { success: true, newBalance: 500, transactionId: 'txn-2' };
        (mockDs.processPayment as jest.Mock).mockResolvedValue(paymentResult);

        const ds = getDataSource();
        const result = await ds.processPayment({
          userId: 'user-1',
          amount: 100,
          paymentMethod: 'campus_card',
          merchantId: 'cafe-1',
          description: 'Lunch',
        });

        expect(result.success).toBe(true);
      });

      it('should handle payment failure', async () => {
        const paymentResult = {
          success: false,
          errorCode: 'INSUFFICIENT_BALANCE',
          errorMessage: '餘額不足',
        };
        (mockDs.processPayment as jest.Mock).mockResolvedValue(paymentResult);

        const ds = getDataSource();
        const result = await ds.processPayment({
          userId: 'user-1',
          amount: 10000,
          paymentMethod: 'campus_card',
          merchantId: 'cafe-1',
          description: 'Expensive item',
        });

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('INSUFFICIENT_BALANCE');
      });
    });

    describe('Library', () => {
      it('should search books', async () => {
        const books = [{ id: 'book-1', title: 'Test Book' }];
        (mockDs.searchBooks as jest.Mock).mockResolvedValue(books);

        const ds = getDataSource();
        const result = await ds.searchBooks('test', 'school-1');

        expect(mockDs.searchBooks).toHaveBeenCalledWith('test', 'school-1');
        expect(result).toEqual(books);
      });

      it('should borrow book', async () => {
        const loan = { id: 'loan-1', bookId: 'book-1', userId: 'user-1' };
        (mockDs.borrowBook as jest.Mock).mockResolvedValue(loan);

        const ds = getDataSource();
        const result = await ds.borrowBook('book-1', 'user-1');

        expect(mockDs.borrowBook).toHaveBeenCalledWith('book-1', 'user-1');
        expect(result).toEqual(loan);
      });

      it('should renew book', async () => {
        const renewedLoan = { id: 'loan-1', dueDate: new Date() };
        (mockDs.renewBook as jest.Mock).mockResolvedValue(renewedLoan);

        const ds = getDataSource();
        const result = await ds.renewBook('loan-1');

        expect(mockDs.renewBook).toHaveBeenCalledWith('loan-1');
        expect(result).toEqual(renewedLoan);
      });
    });

    describe('Grades', () => {
      it('should get GPA', async () => {
        const gpaResult = { gpa: 3.5, totalCredits: 120, totalPoints: 420 };
        (mockDs.getGPA as jest.Mock).mockResolvedValue(gpaResult);

        const ds = getDataSource();
        const result = await ds.getGPA('user-1');

        expect(mockDs.getGPA).toHaveBeenCalledWith('user-1');
        expect(result.gpa).toBe(3.5);
        expect(result.totalCredits).toBe(120);
      });
    });
  });
});
