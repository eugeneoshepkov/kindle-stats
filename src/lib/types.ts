export type ReadingSessionSource = "readingInsights" | "deviceReadingSession";
export type RecommendationEventKind = "view" | "click";

export interface NormalizedBook {
  id: string;
  title: string;
  asin: string | null;
  isbn: string | null;
  personalDocumentId: string | null;
  nonAsinId: string | null;
  authors: string[];
  seriesTitle: string | null;
  seriesAuthor: string | null;
  genres: string[];
  tags: string[];
  ownershipTypes: string[];
  resourceType: string | null;
  contentType: string | null;
  marketplace: string | null;
  isPersonalDocument: boolean;
  coverUrl: string | null;
  coverSource: string | null;
}

export interface NormalizedReadingSession {
  id: string;
  bookId: string;
  source: ReadingSessionSource;
  startTime: string | null;
  endTime: string | null;
  durationMs: number;
  marketplace: string | null;
  deviceFamily: string | null;
  contentType: string | null;
  pageFlips: number | null;
}

export interface NormalizedCompletion {
  bookId: string;
  completedAt: string | null;
  source: string;
}

export interface NormalizedAnnotation {
  bookId: string;
  annotationType: string;
  noteCount: number;
  highlightCount: number;
  lastUpdatedAt: string | null;
}

export interface NormalizedOwnership {
  bookId: string;
  rightType: string | null;
  rightStatus: string | null;
  originType: string | null;
  acquiredDate: string | null;
  lastUpdatedDate: string | null;
  resourceType: string | null;
}

export interface RecommendationEvent {
  id: string;
  kind: RecommendationEventKind;
  asin: string | null;
  cardName: string | null;
  createdAt: string | null;
  marketplace: string | null;
  deviceFamily: string | null;
  cardPosition: number | null;
  itemPositionWithinCard: number | null;
}

export interface ReaderProfileSnapshot {
  marketplace: string | null;
  averageMonthlyReadingDays: number;
  asinCount: number;
  averagePercentReadCompletion: number;
  highestPercentReadCompletion: number;
  fictionPercentage: number | null;
  nonfictionPercentage: number | null;
  scienceFictionFantasyPercentage: number | null;
  selfHelpPercentage: number | null;
  snapshotDate: string | null;
}

export interface MostRecentPageReadEvent {
  bookId: string | null;
  createdAt: string | null;
  marketplace: string | null;
  country: string | null;
  deviceFamily: string | null;
  customerAction: string | null;
  desiredPageLocation: string | null;
}

export interface MostRecentPageReadDialogEvent {
  bookId: string | null;
  createdAt: string | null;
  marketplace: string | null;
  country: string | null;
  deviceFamily: string | null;
  pageWhereDialogWasShown: string | null;
  customerAction: string | null;
  pagesSwipedWhileDialogShown: number | null;
}

export interface BookOpenEvent {
  bookId: string | null;
  createdAt: string | null;
  marketplace: string | null;
  country: string | null;
  deviceFamily: string | null;
  bookFormat: string | null;
  bookCategory: string | null;
  loadMethod: string | null;
  contentLanguage: string | null;
  isContentDownloaded: boolean | null;
}

export interface BookCloseEvent {
  bookId: string | null;
  createdAt: string | null;
  closedAt: string | null;
  marketplace: string | null;
  country: string | null;
  deviceFamily: string | null;
  closeMethod: string | null;
}

export interface AnnotationActionEvent {
  bookId: string | null;
  createdAt: string | null;
  marketplace: string | null;
  country: string | null;
  deviceFamily: string | null;
  action: string | null;
  annotationType: string | null;
  startPosition: string | null;
  totalAnnotations: number | null;
  highlightsCount: number | null;
  textNotesCount: number | null;
  inlineNotesCount: number | null;
  handwrittenStickyNotesCount: number | null;
  underlineCount: number | null;
  bookmarkCount: number | null;
  annotationColor: string | null;
  stickyNoteWindowSeconds: number | null;
  source: string;
}

export interface NotebookActionEvent {
  bookId: string | null;
  createdAt: string | null;
  marketplace: string | null;
  country: string | null;
  deviceFamily: string | null;
  action: string | null;
  entryPoint: string | null;
  source: string;
}

export interface RecommendationImpressionEvent {
  contextBookId: string | null;
  recommendedBookId: string | null;
  createdAt: string | null;
  marketplace: string | null;
  country: string | null;
  deviceFamily: string | null;
  location: string | null;
  position: string | null;
  recommendationType: string | null;
  source: string;
}

export interface SearchQueryEvent {
  createdAt: string | null;
  marketplace: string | null;
  country: string | null;
  deviceFamily: string | null;
  query: string | null;
  searchId: string | null;
  searchSessionId: string | null;
  spellCorrectedKeyword: string | null;
  suggestions: string | null;
  entryLocation: string | null;
  refinements: string | null;
  source: string;
}

export interface SearchResultEvent {
  createdAt: string | null;
  marketplace: string | null;
  country: string | null;
  deviceFamily: string | null;
  searchId: string | null;
  searchSessionId: string | null;
  sectionName: string | null;
  resultPosition: number | null;
  selectedValue: string | null;
  selectedBookId: string | null;
  searchOutcome: string | null;
  searchOutcomeType: string | null;
  progressPercent: number | null;
  reviewStars: number | null;
  totalReviews: number | null;
  wasDownloaded: boolean | null;
  source: string;
}

export interface SendToKindleEvent {
  requestStartedAt: string | null;
  deliveredAt: string | null;
  channel: string | null;
  deliveryStatus: string | null;
  fileSizeBytes: number | null;
  fileType: string | null;
  marketplace: string | null;
  appName: string | null;
  appVersion: string | null;
  operatingSystem: string | null;
  operatingSystemArchitecture: string | null;
}

export interface BookRewardEvent {
  achievementGroupName: string | null;
  achievementName: string | null;
  earnedAt: string | null;
  marketplace: string | null;
  quantity: number | null;
}

export interface LibrarySnapshotEvent {
  createdAt: string | null;
  marketplace: string | null;
  country: string | null;
  deviceFamily: string | null;
  platform: string | null;
  totalItems: number | null;
  numberOfBooks: number | null;
  numberOfDocuments: number | null;
  numberOfItemsRead: number | null;
  numberOfItemsUnread: number | null;
  numberOfItemsDownloaded: number | null;
}

export interface ExtractedData {
  generatedAt: string;
  books: NormalizedBook[];
  readingSessions: NormalizedReadingSession[];
  completions: NormalizedCompletion[];
  annotations: NormalizedAnnotation[];
  ownership: NormalizedOwnership[];
  recommendationEvents: RecommendationEvent[];
  mostRecentPageReadEvents: MostRecentPageReadEvent[];
  mostRecentPageReadDialogEvents: MostRecentPageReadDialogEvent[];
  bookOpenEvents: BookOpenEvent[];
  bookCloseEvents: BookCloseEvent[];
  annotationActionEvents: AnnotationActionEvent[];
  notebookActionEvents: NotebookActionEvent[];
  recommendationImpressionEvents: RecommendationImpressionEvent[];
  searchQueryEvents: SearchQueryEvent[];
  searchResultEvents: SearchResultEvent[];
  sendToKindleEvents: SendToKindleEvent[];
  bookRewardEvents: BookRewardEvent[];
  librarySnapshotEvents: LibrarySnapshotEvent[];
  readingTrackedDays: string[];
  readerProfile: ReaderProfileSnapshot | null;
}

export interface EnrichedBook extends NormalizedBook {
  totalReadingMs: number;
  sessionCount: number;
  completionCount: number;
  annotationCount: number;
  noteCount: number;
  highlightCount: number;
  lastReadAt: string | null;
  lastAnnotatedAt: string | null;
  recommendationViewCount: number;
  recommendationClickCount: number;
  isOwned: boolean;
}

export interface OverviewMetric {
  label: string;
  value: string;
  detail: string;
}

export interface TrendPoint {
  date: string;
  totalReadingHours: number;
  sessions: number;
  titles: number;
}

export interface RankedDimension {
  name: string;
  value: number;
  detail?: string;
}

export interface DiscoveryItem {
  title: string;
  author: string;
  clicks: number;
  readingHours: number;
}

export interface BookRecommendation {
  bookId: string;
  title: string;
  author: string;
  genres: string[];
  seriesTitle: string | null;
  score: number;
  reasons: string[];
  readingHours: number;
}

export interface PersonalizedRecommendation {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  infoUrl: string | null;
  source: string;
  confidence: number;
  reasons: string[];
  matchedGenres: string[];
  matchedAuthors: string[];
}

export interface GenreShare {
  name: string;
  share: number;
}

export interface DaypartShare {
  name: string;
  share: number;
  detail: string;
}

export interface VitalMetric {
  label: string;
  value: string;
  unit?: string;
}

export interface RhythmSummary {
  favoriteWeekday: string;
  favoriteDaypart: string;
  quote: string;
  badges: string[];
}

export interface ReadingMilestones {
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
}

export interface ParallelReadingPoint {
  date: string;
  activeBooks: number;
  smoothedActiveBooks: number;
}

export interface ParallelReadingBook {
  bookId: string;
  title: string;
  author: string;
  coverUrl: string | null;
  contextLabel: string;
  daysSinceLastRead: number | null;
  stalled: boolean;
  activityShare: number;
}

export interface ParallelReadingSummary {
  concurrencyIndex: number;
  peakConcurrentBooks: number;
  chart: ParallelReadingPoint[];
  activeBooks: ParallelReadingBook[];
  resumptionRate: number;
  abandonmentRiskCount: number;
}

export interface FeaturedBook {
  bookId?: string;
  title: string;
  author: string;
  stat: string;
  accent: string;
  coverUrl: string | null;
}

export interface CompletionEvent {
  bookId: string;
  completedAt: string | null;
  source: string;
}

export interface AnalyticsCountItem {
  name: string;
  count: number;
}

export interface AnalyticsBookCountItem {
  bookId: string;
  title: string | null;
  author: string | null;
  count: number;
}

export interface AnalyticsCurrentSignalItem {
  bookId: string | null;
  title: string | null;
  author: string | null;
  createdAt: string | null;
  customerAction?: string | null;
  desiredPageLocation?: string | null;
  loadMethod?: string | null;
  contentLanguage?: string | null;
  deviceFamily: string | null;
}

export interface AnalyticsRewardItem {
  achievementGroupName: string | null;
  achievementName: string | null;
  earnedAt: string | null;
  marketplace: string | null;
  quantity: number | null;
}

export interface AnalyticsLibrarySnapshotItem {
  createdAt: string | null;
  marketplace: string | null;
  country: string | null;
  deviceFamily: string | null;
  platform: string | null;
  totalItems: number | null;
  numberOfBooks: number | null;
  numberOfDocuments: number | null;
  numberOfItemsRead: number | null;
  numberOfItemsUnread: number | null;
  numberOfItemsDownloaded: number | null;
}

export interface AnalyticsSummary {
  generatedAt: string;
  coverage: Record<string, number>;
  currentSignals: {
    latestTrackedDay: string | null;
    latestMostRecentPageRead: AnalyticsCurrentSignalItem[];
    latestBookOpenEvents: AnalyticsCurrentSignalItem[];
  };
  annotationHabits: {
    topAnnotationActions: AnalyticsCountItem[];
    topAnnotationTypes: AnalyticsCountItem[];
    notebookActions: AnalyticsCountItem[];
    topBooksByAnnotationActions: AnalyticsBookCountItem[];
  };
  discoveryHabits: {
    recommendationImpressionLocations: AnalyticsCountItem[];
    recommendationImpressionTypes: AnalyticsCountItem[];
    searchEntryLocations: AnalyticsCountItem[];
    searchOutcomes: AnalyticsCountItem[];
    selectedSearchBooks: AnalyticsBookCountItem[];
  };
  personalDocumentPipeline: {
    sendToKindleChannels: AnalyticsCountItem[];
    sendToKindleStatuses: AnalyticsCountItem[];
    sendToKindleFileTypes: AnalyticsCountItem[];
    successfulSendToKindleCount: number;
  };
  rewards: {
    totalAchievements: number;
    byGroup: AnalyticsCountItem[];
    latest: AnalyticsRewardItem[];
  };
  librarySnapshots: {
    latest: AnalyticsLibrarySnapshotItem[];
    platforms: AnalyticsCountItem[];
  };
}

export interface DashboardData {
  generatedAt: string;
  overview: {
    metrics: OverviewMetric[];
    latestReadingDay: string | null;
    readerProfile: ReaderProfileSnapshot | null;
  };
  trends: {
    daily: TrendPoint[];
    monthly: TrendPoint[];
  };
  libraryTaste: {
    topAuthors: RankedDimension[];
    topGenres: RankedDimension[];
    topSeries: RankedDimension[];
    topBooks: RankedDimension[];
    formatMix: RankedDimension[];
  };
  discovery: {
    recommendationViews: number;
    recommendationClicks: number;
    clickedUnreadBooks: DiscoveryItem[];
  };
  readingInsights: {
    currentPeriodLabel: string;
    currentPeriodValue: string;
    currentPeriodDetail: string;
    currentPeriodChart: TrendPoint[];
    vitalMetrics: VitalMetric[];
    daypartShares: DaypartShare[];
    milestones: ReadingMilestones;
    parallelReading: ParallelReadingSummary;
    genreShares: GenreShare[];
    rhythm: RhythmSummary;
    curatorTip: {
      title: string;
      body: string;
      cta: string;
    };
    featuredBooks: FeaturedBook[];
  };
  books: EnrichedBook[];
  recommendations: BookRecommendation[];
  personalizedRecommendations: PersonalizedRecommendation[];
  completionEvents: CompletionEvent[];
}
