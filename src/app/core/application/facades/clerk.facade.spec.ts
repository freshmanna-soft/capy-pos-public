import { TestBed } from '@angular/core/testing';
import { WritableSignal, computed, signal } from '@angular/core';
import {
  AUTO_ADD_CONFIDENCE,
  ClerkFacade,
  HELP_TEXT,
  MAX_SPEECH_WORDS,
  MOOD_HOLD_MS,
  SpokenAddOutcome,
  SpokenRemoveOutcome,
  UNDO_WINDOW_MS,
} from './clerk.facade';
import { ChoiceActor } from '@core/application/services/candidate-ranking';
import { MAX_SPOKEN_QUANTITY } from '@core/application/services/voice-intent.parser';
import { PosFacade } from './pos.facade';
import { VISION_RECOGNIZER } from '@core/application/ports/vision-recognizer.port';
import { RecognitionResult } from '@core/application/dtos/recognition.dto';
import { ProductService } from '@core/application/services/product.service';
import { CameraService } from '@core/infrastructure/media/camera.service';
import { BarcodeScannerService } from '@core/infrastructure/media/barcode-scanner.service';
import { RecognitionLogService } from '@core/application/services/recognition-log.service';
import { ScannedCode } from '@core/infrastructure/media/barcode-gate';
import { EventBusService } from '@core/infrastructure/messaging/event-bus.service';
import { EventType } from '@core/infrastructure/messaging/event-bus.events';
import { SpeechRecognitionService } from '@core/infrastructure/voice/speech-recognition.service';
import { SpeechSynthesisService } from '@core/infrastructure/voice/speech-synthesis.service';
import { TelemetryService } from '@core/infrastructure/telemetry/telemetry.service';
import { Product } from '@core/domain/entities/product.entity';
import { ClerkMood } from '@features/clerk/canvas/capybara-renderer';

function product(id: string, name: string, stock = 10, price = 3): Product {
  return new Product(
    id,
    name,
    price,
    `${id.toUpperCase()}-SKU`,
    'Produce',
    stock,
    undefined,
    undefined,
    `BAR-${id}`
  );
}

/** A product whose barcode and SKU are set deliberately, for index collisions. */
function coded(id: string, name: string, sku: string, barcode: string): Product {
  return new Product(id, name, 3, sku, 'Produce', 10, undefined, undefined, barcode);
}

const AVOCADO = product('p1', 'Avocado');
const OAT_MILK = product('p2', 'Oat Milk');
const SOURDOUGH = product('p3', 'Sourdough');

/** A high-confidence single hit. */
function confident(id = 'p1', label = 'Avocado'): RecognitionResult {
  return {
    candidates: [{ productId: id, label, confidence: 0.94 }],
    utterance: `One ${label.toLowerCase()}, added.`,
    empty: false,
  };
}

/** Three plausible options, none confident enough to act on. */
function unsure(): RecognitionResult {
  return {
    candidates: [
      { productId: 'p2', label: 'Oat Milk', confidence: 0.74 },
      { productId: 'p3', label: 'Sourdough', confidence: 0.61 },
    ],
    utterance: 'Which one is it?',
    empty: false,
  };
}

/** One code filling a good part of the frame — a deliberate presentation. */
function seen(value: string, width = 0.3): ScannedCode {
  return { value, format: 'ean_13', box: { x: 0.2, y: 0.3, width, height: 0.2 } };
}

function nothing(): RecognitionResult {
  return { candidates: [], utterance: "I can't tell what that is.", empty: true };
}

/**
 * What a spoken name resolved to, as `resolveSpokenName` reports it.
 *
 * Restated here rather than exported from the facade: the shape is an internal
 * detail of the resolver, and exporting it to satisfy a test would widen the very
 * surface this story is narrowing.
 */
type Resolution =
  | { kind: 'none' }
  | { kind: 'one'; product: Product }
  | { kind: 'ambiguous'; products: Product[] };

/**
 * The private seam a future tool table is a closure over.
 *
 * Reached by cast on purpose. These methods are private precisely so nothing
 * outside the facade can reach them, and the `'agent'` actor has to be exercised
 * without a public door being opened for it — an optional actor argument on
 * `chooseCandidate` would reopen the hole from outside, which is what makes the
 * cast the honest way to test this rather than a shortcut around a missing API.
 */
interface ClerkSeam {
  addByName(query: string[], quantity: number, confirmedBy?: ChoiceActor): SpokenAddOutcome;
  removeByName(query: string[], quantity: number): SpokenRemoveOutcome;
  resolveSpokenName(query: string[]): Resolution;
}

function seam(facade: ClerkFacade): ClerkSeam {
  return facade as unknown as ClerkSeam;
}

describe('ClerkFacade', () => {
  let clerk: ClerkFacade;
  let identify: ReturnType<typeof vi.fn>;
  let cameraStart: ReturnType<typeof vi.fn>;
  let captureFrame: ReturnType<typeof vi.fn>;
  let speak: ReturnType<typeof vi.fn>;
  let cancelSpeech: ReturnType<typeof vi.fn>;
  let speaking: WritableSignal<boolean>;
  let muted: WritableSignal<boolean>;
  /** What actually reached the speaker, as opposed to what was handed to it. */
  let spokenAloud: string[];
  let earPause: ReturnType<typeof vi.fn>;
  let earResume: ReturnType<typeof vi.fn>;
  let earStart: ReturnType<typeof vi.fn>;
  let earStop: ReturnType<typeof vi.fn>;
  let onFinalPhrase: (phrase: string) => void;
  let tryAddToCart: ReturnType<typeof vi.fn>;
  let decreaseQuantity: ReturnType<typeof vi.fn>;
  let removeFromCart: ReturnType<typeof vi.fn>;
  let getQuantity: ReturnType<typeof vi.fn>;
  let cartItems: WritableSignal<{ product: Product; quantity: number }[]>;
  let cameraPause: ReturnType<typeof vi.fn>;
  let barcodeSupported: WritableSignal<boolean>;
  let cameraResume: ReturnType<typeof vi.fn>;
  let publish: ReturnType<typeof vi.fn>;
  let getActiveProducts: ReturnType<typeof vi.fn>;
  let sampleFrame: ReturnType<typeof vi.fn>;
  let cameras: WritableSignal<{ deviceId: string; label: string }[]>;
  let activeCameraId: WritableSignal<string | null>;
  let selectCamera: ReturnType<typeof vi.fn>;
  let detectionSource: ReturnType<typeof vi.fn>;
  let detectCodes: ReturnType<typeof vi.fn>;
  let prepareScanner: ReturnType<typeof vi.fn>;
  let recordCounter: ReturnType<typeof vi.fn>;
  let logRecord: ReturnType<typeof vi.fn>;
  let logAmend: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    identify = vi.fn().mockResolvedValue(confident());
    cameraStart = vi.fn().mockResolvedValue(true);
    captureFrame = vi.fn().mockReturnValue({ base64: 'ZmFrZQ==', width: 768, height: 576 });
    muted = signal(false);
    spokenAloud = [];
    // Mirrors the real service, where the mute gate lives: the facade hands over
    // every line it captions and the voice decides whether any of it is heard.
    speak = vi.fn((text: string) => {
      if (!muted()) {
        spokenAloud.push(text);
      }
    });
    cancelSpeech = vi.fn();
    speaking = signal(false);
    earPause = vi.fn();
    earResume = vi.fn();
    earStart = vi.fn();
    earStop = vi.fn();
    cartItems = signal<{ product: Product; quantity: number }[]>([]);
    // A cart that actually holds things, rather than one that only says yes. The
    // facade reads quantities back before it removes anything, so a mock that
    // accepted adds without recording them would make every removal look like a
    // removal from an empty cart.
    tryAddToCart = vi.fn((product: Product) => {
      cartItems.update((items) =>
        items.some((item) => item.product.id === product.id)
          ? items.map((item) =>
              item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
            )
          : [...items, { product, quantity: 1 }]
      );
      return { added: true };
    });
    removeFromCart = vi.fn((productId: string) =>
      cartItems.update((items) => items.filter((item) => item.product.id !== productId))
    );
    // Answers from the cart the test set up, so a removal is bounded by what is
    // really there — the facade checks this before every decrement.
    getQuantity = vi.fn(
      (productId: string) =>
        cartItems().find((item) => item.product.id === productId)?.quantity ?? 0
    );
    cameraPause = vi.fn();
    barcodeSupported = signal(true);
    cameraResume = vi.fn().mockResolvedValue(true);
    decreaseQuantity = vi.fn((productId: string) =>
      cartItems.update((items) =>
        items.flatMap((item) =>
          item.product.id === productId
            ? item.quantity > 1
              ? [{ ...item, quantity: item.quantity - 1 }]
              : []
            : [item]
        )
      )
    );
    publish = vi.fn();
    getActiveProducts = vi.fn().mockResolvedValue([AVOCADO, OAT_MILK, SOURDOUGH]);
    sampleFrame = vi.fn().mockReturnValue(new Uint8Array(16));
    cameras = signal([
      { deviceId: 'cam-a', label: 'Overhead' },
      { deviceId: 'cam-b', label: 'Shelf' },
    ]);
    activeCameraId = signal<string | null>('cam-a');
    selectCamera = vi.fn().mockImplementation(async (id: string) => {
      activeCameraId.set(id);
      return true;
    });
    // A video element with real dimensions, so the barcode pass runs.
    detectionSource = vi.fn().mockReturnValue({ videoWidth: 1280, videoHeight: 720 });
    detectCodes = vi.fn().mockResolvedValue([]);
    prepareScanner = vi.fn().mockResolvedValue(true);
    recordCounter = vi.fn();
    logRecord = vi.fn().mockImplementation(() => 'log-1');
    logAmend = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        ClerkFacade,
        { provide: VISION_RECOGNIZER, useValue: { identify, kind: 'demo' } },
        {
          provide: CameraService,
          useValue: {
            status: signal('live'),
            message: signal(''),
            start: cameraStart,
            stop: vi.fn(),
            pause: cameraPause,
            resume: cameraResume,
            sampleFrame,
            captureFrame,
            cameras,
            activeCameraId,
            hasChoice: computed(() => cameras().length > 1),
            select: selectCamera,
            detectionSource,
            activeCameraLabel: () =>
              cameras().find((camera) => camera.deviceId === activeCameraId())?.label ?? 'Camera',
          },
        },
        {
          provide: SpeechSynthesisService,
          useValue: {
            supported: true,
            speaking,
            lastBoundaryAt: signal(0),
            speak,
            cancel: cancelSpeech,
            muted,
            // The real service refuses to speak while muted, so the mock has to as
            // well — otherwise a "says nothing while muted" assertion would pass
            // whether or not the facade got it right.
            setMuted: (value: boolean) => muted.set(value),
          },
        },
        {
          provide: SpeechRecognitionService,
          useValue: {
            supported: true,
            interim: signal(''),
            onFinalPhrase: (handler: (phrase: string) => void) => {
              onFinalPhrase = handler;
            },
            start: earStart,
            stop: earStop,
            pause: earPause,
            resume: earResume,
          },
        },
        {
          provide: PosFacade,
          useValue: {
            tryAddToCart,
            decreaseQuantity,
            removeFromCart,
            getQuantity,
            cartItems,
            totalItems: signal(2),
            total: signal(7.5),
            isCartEmpty: signal(false),
          },
        },
        { provide: ProductService, useValue: { getActiveProducts } },
        { provide: EventBusService, useValue: { publish } },
        { provide: TelemetryService, useValue: { recordCounter } },
        {
          provide: BarcodeScannerService,
          useValue: { supported: barcodeSupported, prepare: prepareScanner, detect: detectCodes },
        },
        {
          provide: RecognitionLogService,
          useValue: { record: logRecord, amend: logAmend, summarise: vi.fn(), clear: vi.fn() },
        },
      ],
    });

    clerk = TestBed.inject(ClerkFacade);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await clerk.start();
  });

  afterEach(() => {
    clerk.stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('starting a session', () => {
    it('loads the catalog, opens the camera and greets the cashier', () => {
      expect(getActiveProducts).toHaveBeenCalled();
      expect(cameraStart).toHaveBeenCalled();
      expect(clerk.phase()).toBe('ready');
      expect(speak).toHaveBeenCalledWith(expect.stringContaining('Hold something up'));
      expect(clerk.caption()).toContain('Hold something up');
    });

    it('sends the real catalog to the recognizer, not a guess at one', async () => {
      clerk.scanNow();
      await vi.waitFor(() => expect(identify).toHaveBeenCalled());

      const [request] = identify.mock.calls[0] as [{ catalog: { id: string }[] }];
      expect(request.catalog.map((hint) => hint.id)).toEqual(['p1', 'p2', 'p3']);
    });

    it('is blocked, not merely quiet, when the camera will not open', async () => {
      clerk.stop();
      cameraStart.mockResolvedValue(false);

      await clerk.start();

      expect(clerk.phase()).toBe('blocked');
      expect(clerk.visualState()).toBe('confused');
    });

    it('starts anyway when the catalog fails to load, and says nothing can be matched', async () => {
      clerk.stop();
      getActiveProducts.mockRejectedValue(new Error('db down'));

      await clerk.start();

      expect(clerk.phase()).toBe('ready');
      clerk.scanNow();
      await vi.waitFor(() => expect(identify).toHaveBeenCalled());
      const [request] = identify.mock.calls[0] as [{ catalog: unknown[] }];
      expect(request.catalog).toEqual([]);
    });
  });

  describe('high confidence', () => {
    it('adds the item and announces it', async () => {
      clerk.scanNow();

      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalledWith(AVOCADO));
      expect(clerk.visualState()).toBe('found');
      expect(clerk.caption()).toBe('One avocado, added.');
      expect(clerk.addedCount()).toBe(1);
      expect(clerk.candidateCards()).toHaveLength(0);
    });

    it('drops the yuzu only once the cart write has succeeded', async () => {
      const before = clerk.plopToken();
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.plopToken()).toBe(before + 1));
    });

    it('opens a reversible window', async () => {
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.pendingAdd()).not.toBeNull());

      expect(clerk.pendingAdd()).toEqual({ productId: 'p1', label: 'Avocado', quantity: 1 });
      expect(clerk.undoMsLeft()).toBe(UNDO_WINDOW_MS);
      expect(clerk.undoSecondsLeft()).toBe(UNDO_WINDOW_MS / 1000);
    });

    it('publishes the recognition for the agent monitor', async () => {
      clerk.scanNow();
      await vi.waitFor(() => expect(publish).toHaveBeenCalled());

      const message = publish.mock.calls[0]![0] as { type: string; payload: { auto: boolean } };
      expect(message.type).toBe(EventType.CLERK_ITEM_RECOGNIZED);
      expect(message.payload.auto).toBe(true);
    });

    it('reports out of stock instead of adding, and offers no undo', async () => {
      // Stock is the terminal's rule, not the clerk's — she only relays it.
      tryAddToCart.mockReturnValue({ added: false, reason: 'out-of-stock' });

      clerk.scanNow();

      await vi.waitFor(() => expect(clerk.caption()).toContain('out of stock'));
      expect(clerk.pendingAdd()).toBeNull();
      expect(clerk.addedCount()).toBe(0);
      expect(clerk.visualState()).toBe('confused');
    });

    it('says the shelf is empty when the cart already holds all the stock', async () => {
      tryAddToCart.mockReturnValue({ added: false, reason: 'max-stock-reached' });

      clerk.scanNow();

      await vi.waitFor(() => expect(clerk.caption().toLowerCase()).toContain("that's all"));
      expect(clerk.pendingAdd()).toBeNull();
    });

    it('will not add a product that is not in the catalog', async () => {
      identify.mockResolvedValue(confident('ghost', 'Ghost'));

      clerk.scanNow();

      await vi.waitFor(() => expect(clerk.visualState()).toBe('confused'));
      expect(tryAddToCart).not.toHaveBeenCalled();
    });
  });

  describe('medium confidence', () => {
    beforeEach(async () => {
      identify.mockResolvedValue(unsure());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));
    });

    it('offers the options instead of picking one', () => {
      expect(tryAddToCart).not.toHaveBeenCalled();
      expect(clerk.caption()).toBe('Which one is it?');
      expect(clerk.visualState()).toBe('confused');
    });

    it('joins each option to its price and SKU so they can be told apart', () => {
      const cards = clerk.candidateCards();
      expect(cards).toHaveLength(2);
      expect(cards[0]).toMatchObject({
        position: 1,
        productId: 'p2',
        label: 'Oat Milk',
        sku: 'P2-SKU',
        price: 3,
      });
    });

    it('adds the option the cashier picks', () => {
      clerk.chooseCandidate(2);
      expect(tryAddToCart).toHaveBeenCalledWith(SOURDOUGH);
      expect(clerk.awaitingChoice()).toBe(false);
    });

    it('takes the top option on a bare confirmation', () => {
      clerk.confirmTop();
      expect(tryAddToCart).toHaveBeenCalledWith(OAT_MILK);
    });

    it('ignores a position that was never offered', () => {
      clerk.chooseCandidate(9);
      expect(tryAddToCart).not.toHaveBeenCalled();
      expect(clerk.awaitingChoice()).toBe(true);
    });

    it('clears the options and looks again when all are rejected', () => {
      clerk.reject();
      expect(clerk.awaitingChoice()).toBe(false);
      expect(clerk.confidence()).toBe(0);
      expect(clerk.visualState()).toBe('idle');
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: EventType.CLERK_ITEM_REJECTED })
      );
    });

    it('still enforces stock on a hand-picked option', () => {
      // Choosing by hand skips the model's doubt, not the shop's inventory.
      tryAddToCart.mockReturnValue({ added: false, reason: 'out-of-stock' });
      clerk.chooseCandidate(1);
      expect(clerk.pendingAdd()).toBeNull();
      expect(clerk.caption()).toContain('out of stock');
    });
  });

  describe('low confidence', () => {
    it('asks for another look rather than guessing', async () => {
      identify.mockResolvedValue(nothing());

      clerk.scanNow();

      await vi.waitFor(() => expect(clerk.visualState()).toBe('confused'));
      expect(tryAddToCart).not.toHaveBeenCalled();
      expect(clerk.candidateCards()).toHaveLength(0);
      expect(clerk.caption()).toContain("can't tell");
    });

    it('does not act on a candidate below the consider threshold', async () => {
      identify.mockResolvedValue({
        candidates: [{ productId: 'p1', label: 'Avocado', confidence: 0.3 }],
        utterance: 'Not sure.',
        empty: false,
      });

      clerk.scanNow();

      await vi.waitFor(() => expect(clerk.visualState()).toBe('confused'));
      expect(tryAddToCart).not.toHaveBeenCalled();
      expect(clerk.awaitingChoice()).toBe(false);
    });
  });

  describe('undo', () => {
    /** Get one item into the cart and its undo window open. */
    async function addOne(id = 'p1', label = 'Avocado'): Promise<void> {
      identify.mockResolvedValue(confident(id, label));
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.pendingAdd()?.productId).toBe(id));
    }

    it('reverses exactly the one add it recorded', async () => {
      await addOne();

      clerk.undoLast();

      expect(decreaseQuantity).toHaveBeenCalledExactlyOnceWith('p1');
      expect(clerk.pendingAdd()).toBeNull();
      expect(clerk.addedCount()).toBe(0);
      expect(clerk.caption()).toContain('removed');
    });

    it('cannot be applied twice', async () => {
      await addOne();

      clerk.undoLast();
      clerk.undoLast();

      expect(decreaseQuantity).toHaveBeenCalledTimes(1);
    });

    it('replaces the previous window when a second item is added', async () => {
      await addOne();
      await addOne('p2', 'Oat Milk');

      clerk.undoLast();

      // Only the most recent add is reversible — otherwise "undo" is ambiguous.
      expect(decreaseQuantity).toHaveBeenCalledExactlyOnceWith('p2');
    });

    it('closes the window after four seconds, and does nothing after that', async () => {
      // Fake timers have to be installed before the window opens, or the real
      // interval it schedules is invisible to advanceTimersByTime.
      sampleFrame.mockReturnValue(null); // silence the background scan loop
      vi.useFakeTimers();
      identify.mockResolvedValue(confident());

      clerk.scanNow();
      await vi.advanceTimersByTimeAsync(1);
      expect(clerk.pendingAdd()).not.toBeNull();

      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 500);
      expect(clerk.pendingAdd()).toBeNull();
      expect(clerk.visualState()).toBe('idle');

      clerk.undoLast();
      expect(decreaseQuantity).not.toHaveBeenCalled();
    });

    it('counts down while the window is open', async () => {
      sampleFrame.mockReturnValue(null);
      vi.useFakeTimers();
      identify.mockResolvedValue(confident());

      clerk.scanNow();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(2000);

      expect(clerk.undoMsLeft()).toBeLessThan(UNDO_WINDOW_MS);
      expect(clerk.undoMsLeft()).toBeGreaterThan(0);
    });
  });

  describe('voice', () => {
    it('stops listening while it speaks, so it does not hear itself', () => {
      // Without this she transcribes her own announcement and can answer her own
      // question.
      speaking.set(true);
      TestBed.tick();
      expect(earPause).toHaveBeenCalled();

      speaking.set(false);
      TestBed.tick();
      expect(earResume).toHaveBeenCalled();
    });

    it('turns the microphone on and off', () => {
      clerk.toggleMic();
      expect(clerk.micEnabled()).toBe(true);
      expect(earStart).toHaveBeenCalled();

      clerk.toggleMic();
      expect(clerk.micEnabled()).toBe(false);
      expect(earStop).toHaveBeenCalled();
    });

    it('acts on "yes" by taking the top option', async () => {
      identify.mockResolvedValue(unsure());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));

      onFinalPhrase('yes that one');

      expect(tryAddToCart).toHaveBeenCalledWith(OAT_MILK);
    });

    it('acts on a spoken position', async () => {
      identify.mockResolvedValue(unsure());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));

      onFinalPhrase('the second one');

      expect(tryAddToCart).toHaveBeenCalledWith(SOURDOUGH);
    });

    it('acts on "undo"', async () => {
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.pendingAdd()).not.toBeNull());

      onFinalPhrase('undo');

      expect(decreaseQuantity).toHaveBeenCalledWith('p1');
    });

    it('reads the total aloud', () => {
      onFinalPhrase('how much is it');
      expect(clerk.caption()).toBe('2 items, 7.50 dollars.');
    });

    it('asks the page to open checkout rather than navigating itself', () => {
      const before = clerk.checkoutRequested();
      onFinalPhrase('checkout please');
      expect(clerk.checkoutRequested()).toBe(before + 1);
    });

    it('ignores conversation it has no command for', () => {
      const caption = clerk.caption();
      onFinalPhrase('lovely weather today');
      expect(clerk.caption()).toBe(caption);
      expect(tryAddToCart).not.toHaveBeenCalled();
    });
  });

  describe('the free local verbs', () => {
    /** The model tier, standing in for anything that would cost a round trip. */
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchSpy = vi.fn();
      vi.spyOn(globalThis, 'fetch').mockImplementation(fetchSpy as unknown as typeof fetch);
      // The greeting has already been said by the time these run; every assertion
      // below is about what the verb itself did.
      identify.mockClear();
      tryAddToCart.mockClear();
      logRecord.mockClear();
      publish.mockClear();
      speak.mockClear();
      spokenAloud.length = 0;
    });

    it('says the last thing again without rewriting it', () => {
      onFinalPhrase('how much is it');
      expect(clerk.caption()).toBe('2 items, 7.50 dollars.');
      speak.mockClear();
      spokenAloud.length = 0;

      onFinalPhrase('say that again');

      expect(spokenAloud).toEqual(['2 items, 7.50 dollars.']);
      // A repeat reads the caption out; it is not a new answer, so it must not
      // become one on the screen reading of the session.
      expect(clerk.caption()).toBe('2 items, 7.50 dollars.');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('answers rather than doing nothing when she has not said anything yet', () => {
      // A facade that has not started has an empty caption, which is the only way
      // that fork is reachable — `say` never blanks it afterwards. Silence here
      // would be indistinguishable from a dead button, which is the whole reason
      // `undoLast` answers "Nothing to undo" instead of returning quietly.
      const fresh = TestBed.runInInjectionContext(() => new ClerkFacade());
      expect(fresh.caption()).toBe('');

      fresh.repeatLast();

      expect(fresh.caption()).toBe('Nothing to repeat yet.');
      expect(spokenAloud).toEqual(['Nothing to repeat yet.']);
    });

    it('still hands a repeat to the voice while muted, and lets the gate drop it', () => {
      clerk.setMuted(true);
      const caption = clerk.caption();
      speak.mockClear();
      spokenAloud.length = 0;

      onFinalPhrase('say that again');

      // The facade does not second-guess the mute: the service owns that gate, so
      // there is exactly one place that decides whether a line is heard.
      expect(speak).toHaveBeenCalledTimes(1);
      expect(speak).toHaveBeenCalledWith(caption);
      expect(spokenAloud).toEqual([]);
      expect(clerk.muted()).toBe(true);
      expect(clerk.caption()).toBe(caption);
    });

    it('names what she can do from the constant, not from prose', () => {
      onFinalPhrase('what can you do');

      expect(speak).toHaveBeenCalledWith(HELP_TEXT);
      expect(clerk.caption()).toBe(HELP_TEXT);
      expect(tryAddToCart).not.toHaveBeenCalled();
      expect(identify).not.toHaveBeenCalled();
    });

    it('keeps the help answer inside the spoken budget and naming every verb', () => {
      // Asserted against the exported ceiling rather than a literal, so stories
      // that also speak have one number to obey instead of a sentence about one.
      expect(HELP_TEXT.trim().split(/\s+/).length).toBeLessThanOrEqual(MAX_SPEECH_WORDS);
      expect(HELP_TEXT).toMatch(/add/i);
      expect(HELP_TEXT).toMatch(/remove/i);
      expect(HELP_TEXT).toMatch(/total/i);
      expect(HELP_TEXT).toMatch(/undo/i);
      expect(HELP_TEXT).toMatch(/checkout/i);
    });

    it('acknowledges "never mind" without touching the sale', async () => {
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.pendingAdd()).not.toBeNull());
      const pending = clerk.pendingAdd();
      const msLeft = clerk.undoMsLeft();
      const items = cartItems();
      tryAddToCart.mockClear();
      decreaseQuantity.mockClear();
      speak.mockClear();
      spokenAloud.length = 0;

      onFinalPhrase('never mind');

      expect(spokenAloud).toEqual(['Okay.']);
      expect(clerk.mood()).toBe(ClerkMood.NEUTRAL);
      // "The cashier moved on", not "put that back": the add keeps the rest of its
      // window, and taking it off is still one word away.
      expect(clerk.pendingAdd()).toBe(pending);
      expect(clerk.undoMsLeft()).toBe(msLeft);
      expect(cartItems()).toBe(items);
      expect(tryAddToCart).not.toHaveBeenCalled();
      expect(decreaseQuantity).not.toHaveBeenCalled();
    });

    it('routes every verb through exactly one named method, whatever the input', () => {
      // This is what story 4's one-line abort insertion depends on: one body per
      // verb, and a key or a button that calls it rather than repeating it.
      const repeatLast = vi.spyOn(clerk, 'repeatLast');
      const dismiss = vi.spyOn(clerk, 'dismiss');
      const speakHelp = vi.spyOn(clerk, 'speakHelp');

      onFinalPhrase('say that again');
      onFinalPhrase('never mind');
      onFinalPhrase('what can you do');

      expect(repeatLast).toHaveBeenCalledTimes(1);
      expect(dismiss).toHaveBeenCalledTimes(1);
      expect(speakHelp).toHaveBeenCalledTimes(1);
      expect(spokenAloud).toHaveLength(3);
    });

    it.each(['say that again', 'never mind', 'what can you do'])(
      'answers "%s" without the recognizer, the cart, the log or the network',
      (phrase) => {
        onFinalPhrase(phrase);

        expect(identify).not.toHaveBeenCalled();
        expect(tryAddToCart).not.toHaveBeenCalled();
        expect(logRecord).not.toHaveBeenCalled();
        expect(fetchSpy).not.toHaveBeenCalled();
        // Nothing was recognized and nothing was sold, so there is nothing for the
        // recognition log or the bus to measure.
        expect(publish).not.toHaveBeenCalled();
      }
    );
  });

  describe('look again', () => {
    it('forces a fresh look on demand', async () => {
      clerk.scanNow();
      await vi.waitFor(() => expect(identify).toHaveBeenCalledTimes(1));

      clerk.scanNow();
      await vi.waitFor(() => expect(identify).toHaveBeenCalledTimes(2));
    });

    it('will not start a second look while one is in flight', async () => {
      let release: (result: RecognitionResult) => void = () => undefined;
      identify.mockImplementation(
        () => new Promise<RecognitionResult>((resolve) => (release = resolve))
      );

      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.busy()).toBe(true));
      clerk.scanNow();

      expect(identify).toHaveBeenCalledTimes(1);
      release(nothing());
    });

    it('does nothing when the session is not running', () => {
      clerk.stop();
      clerk.scanNow();
      expect(identify).not.toHaveBeenCalled();
    });

    it('does nothing when there is no frame to read', async () => {
      captureFrame.mockReturnValue(null);
      clerk.scanNow();
      await Promise.resolve();
      expect(identify).not.toHaveBeenCalled();
    });
  });

  describe('the scanning loop', () => {
    /**
     * Restart the session under fake timers with a stable camera scene, then let
     * the real FrameGate settle. Every other test here drives recognition through
     * `scanNow`, which bypasses the gate — so this is the only place the actual
     * hands-free path is exercised, and it is the path a cashier uses.
     */
    async function runScanningSession(sample = new Uint8Array(16).fill(120)): Promise<void> {
      clerk.stop();
      vi.useFakeTimers();
      sampleFrame.mockReturnValue(sample);
      await clerk.start();
    }

    it('looks at the counter once the scene holds still', async () => {
      await runScanningSession();

      await vi.advanceTimersByTimeAsync(2000);

      expect(identify).toHaveBeenCalled();
      expect(tryAddToCart).toHaveBeenCalledWith(AVOCADO);
    });

    it('does not look while the scene is still moving', async () => {
      clerk.stop();
      vi.useFakeTimers();
      // A different frame every sample: a hand in motion.
      let n = 0;
      sampleFrame.mockImplementation(() => new Uint8Array(16).fill((n += 90) % 255));
      await clerk.start();

      await vi.advanceTimersByTimeAsync(3000);

      expect(identify).not.toHaveBeenCalled();
    });

    it('does not look again while it is waiting to be told which item it is', async () => {
      identify.mockResolvedValue(unsure());
      await runScanningSession();
      await vi.advanceTimersByTimeAsync(2000);
      expect(clerk.awaitingChoice()).toBe(true);

      identify.mockClear();
      await vi.advanceTimersByTimeAsync(5000);

      // A new capture here would replace the question the cashier is answering.
      expect(identify).not.toHaveBeenCalled();
    });

    it('does not look again while a look is already in flight', async () => {
      identify.mockImplementation(() => new Promise<RecognitionResult>(() => undefined));
      await runScanningSession();

      await vi.advanceTimersByTimeAsync(6000);

      expect(identify).toHaveBeenCalledTimes(1);
    });

    it('waits patiently when the camera has no frame yet', async () => {
      clerk.stop();
      vi.useFakeTimers();
      sampleFrame.mockReturnValue(null);
      await clerk.start();

      await vi.advanceTimersByTimeAsync(4000);

      expect(identify).not.toHaveBeenCalled();
    });

    it('leans in to listen when the mic is on and something moves', async () => {
      clerk.stop();
      vi.useFakeTimers();
      let n = 0;
      sampleFrame.mockImplementation(() => new Uint8Array(16).fill((n += 90) % 255));
      await clerk.start();
      clerk.toggleMic();

      await vi.advanceTimersByTimeAsync(600);

      expect(clerk.visualState()).toBe('listening');
    });

    it('stops looking once the session is closed', async () => {
      await runScanningSession();
      await vi.advanceTimersByTimeAsync(2000);
      const looks = identify.mock.calls.length;

      clerk.stop();
      await vi.advanceTimersByTimeAsync(5000);

      expect(identify).toHaveBeenCalledTimes(looks);
    });

    it('discards a result that arrives after the cashier moved on', async () => {
      let release: (result: RecognitionResult) => void = () => undefined;
      identify.mockImplementation(
        () => new Promise<RecognitionResult>((resolve) => (release = resolve))
      );
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.busy()).toBe(true));

      clerk.stop(); // aborts the in-flight request
      release(confident());
      await Promise.resolve();

      expect(tryAddToCart).not.toHaveBeenCalled();
    });
  });

  describe('small mercies', () => {
    it('does not restart a session that is already running', async () => {
      getActiveProducts.mockClear();

      await clerk.start();

      expect(getActiveProducts).not.toHaveBeenCalled();
    });

    it('falls back to its own wording when the recognizer says nothing', async () => {
      identify.mockResolvedValue({
        candidates: [{ productId: 'p1', label: 'Avocado', confidence: 0.95 }],
        utterance: '',
        empty: false,
      });

      clerk.scanNow();

      await vi.waitFor(() => expect(clerk.caption()).toBe('One avocado, added.'));
    });

    it('asks its own question when the recognizer offers no wording', async () => {
      identify.mockResolvedValue({ ...unsure(), utterance: '' });

      clerk.scanNow();

      await vi.waitFor(() => expect(clerk.caption()).toBe('Which one is it?'));
    });

    it('asks for another look in its own words', async () => {
      identify.mockResolvedValue({ candidates: [], utterance: '', empty: true });

      clerk.scanNow();

      await vi.waitFor(() => expect(clerk.caption()).toContain("can't tell"));
    });

    it('says the cart is empty rather than reading out zero', () => {
      const totalItems = TestBed.inject(PosFacade).totalItems as unknown as {
        set(v: number): void;
      };
      totalItems.set(0);

      clerk.speakTotal();

      expect(clerk.caption()).toBe('The cart is empty.');
    });

    it('says "item" for one and "items" for more', () => {
      const totalItems = TestBed.inject(PosFacade).totalItems as unknown as {
        set(v: number): void;
      };
      totalItems.set(1);
      clerk.speakTotal();
      expect(clerk.caption()).toContain('1 item,');

      totalItems.set(3);
      clerk.speakTotal();
      expect(clerk.caption()).toContain('3 items,');
    });

    it('does not choose an option whose product has left the catalog', async () => {
      identify.mockResolvedValue(unsure());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));
      getActiveProducts.mockResolvedValue([]);
      clerk.stop();
      await clerk.start();
      // Offer the same options again, now with an empty catalog behind them.
      identify.mockResolvedValue(unsure());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));

      clerk.chooseCandidate(1);

      expect(tryAddToCart).not.toHaveBeenCalled();
      expect(clerk.caption()).toContain('Show me again');
    });

    it('shows a placeholder for an option it cannot price', async () => {
      // The recognizer's label survives even when the product is gone, so the
      // cashier sees something rather than a blank card.
      getActiveProducts.mockResolvedValue([]);
      clerk.stop();
      await clerk.start();
      identify.mockResolvedValue(unsure());

      clerk.scanNow();

      await vi.waitFor(() => expect(clerk.candidateCards().length).toBeGreaterThan(0));
      expect(clerk.candidateCards()[0]).toMatchObject({ label: 'Oat Milk', sku: '—', price: 0 });
    });

    it('looks toward what it is reading, and straight ahead when idle', async () => {
      expect(clerk.gaze()).toEqual({ x: 0, y: 0 });

      identify.mockImplementation(() => new Promise<RecognitionResult>(() => undefined));
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.visualState()).toBe('scanning'));
      expect(clerk.gaze().x).toBeGreaterThan(0);
    });

    it('looks away when confused and up when it finds something', async () => {
      identify.mockResolvedValue(nothing());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.visualState()).toBe('confused'));
      expect(clerk.gaze().x).toBeLessThan(0);

      identify.mockResolvedValue(confident());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.visualState()).toBe('found'));
      expect(clerk.gaze().y).toBeLessThan(0);
    });
  });

  describe('scanning a barcode', () => {
    it('prepares the detector and mentions barcodes in the greeting', () => {
      expect(prepareScanner).toHaveBeenCalled();
      expect(clerk.caption()).toContain('barcode');
    });

    it('does not mention barcodes when the browser cannot read them', async () => {
      clerk.stop();
      prepareScanner.mockResolvedValue(false);

      await clerk.start();

      expect(clerk.caption()).not.toContain('barcode');
      expect(clerk.caption()).toContain('Hold something up');
    });

    it('rings up a product from its barcode without paying for a look', async () => {
      // The whole point: a barcode is unambiguous and read on device, so it costs
      // no recognition call at all.
      detectCodes.mockResolvedValue([seen('BAR-p1')]);

      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalledWith(AVOCADO));
      expect(identify).not.toHaveBeenCalled();
      expect(clerk.caption()).toBe('One avocado, added.');
    });

    it('matches on SKU too, for shelf labels', async () => {
      detectCodes.mockResolvedValue([seen('P2-SKU')]);

      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalledWith(OAT_MILK));
    });

    it('marks a known code green and an unknown one red', async () => {
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.waitFor(() => expect(clerk.codes()).toHaveLength(1));
      expect(clerk.codes()[0]!.matched).toBe(true);

      detectCodes.mockResolvedValue([seen('NOT-STOCKED')]);
      await vi.waitFor(() => expect(clerk.codes()[0]!.matched).toBe(false));
    });

    it('says so when a code is readable but not stocked', async () => {
      detectCodes.mockResolvedValue([seen('NOT-STOCKED')]);

      await vi.waitFor(() => expect(clerk.caption()).toContain("isn't in the catalogue"));
      expect(tryAddToCart).not.toHaveBeenCalled();
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EventType.CLERK_ITEM_REJECTED,
          payload: expect.objectContaining({ reason: 'unknown-barcode' }),
        })
      );
    });

    it('adds one item however many frames the code is held for', async () => {
      // Sixteen frames of one jar is one jar.
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalledTimes(1));

      await new Promise((resolve) => setTimeout(resolve, 600));

      expect(tryAddToCart).toHaveBeenCalledTimes(1);
    });

    it('does not let the model add the item the barcode already rang up', async () => {
      // The scene stays still after a scan, so without claiming it the frame gate
      // opens a third of a second later, the model is asked about the same jar, and
      // the customer is charged for two.
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalledTimes(1));

      await new Promise((resolve) => setTimeout(resolve, 700));

      expect(identify).not.toHaveBeenCalled();
      expect(tryAddToCart).toHaveBeenCalledTimes(1);
    });

    it('still lets the model try when the code is not in the catalogue', async () => {
      // The catalogue may simply be missing that barcode while the product itself
      // is stocked, so the model gets its turn.
      detectCodes.mockResolvedValue([seen('NOT-STOCKED')]);
      await vi.waitFor(() => expect(clerk.caption()).toContain("isn't in the catalogue"));

      await vi.waitFor(() => expect(identify).toHaveBeenCalled(), { timeout: 3000 });
    });

    it('reports the frame size the boxes are relative to', async () => {
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.waitFor(() => expect(clerk.codes()).toHaveLength(1));
      expect(clerk.frameSize()).toEqual({ width: 1280, height: 720 });
    });

    it('does not forget a held code when a frame goes unexamined', async () => {
      // `null` means the decoder was still busy, not that the item was taken away.
      // Treating the two alike would let a slow decoder ring the same jar up twice.
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalledTimes(1));

      detectCodes.mockResolvedValue(null);
      await new Promise((resolve) => setTimeout(resolve, 1400));
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(tryAddToCart).toHaveBeenCalledTimes(1);
    });

    it('keeps the boxes it last drew through an unexamined frame', async () => {
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.waitFor(() => expect(clerk.codes()).toHaveLength(1));

      detectCodes.mockResolvedValue(null);
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Blanking them would make the brackets flicker whenever decoding ran long.
      expect(clerk.codes()).toHaveLength(1);
    });

    it('drops the boxes when the code leaves the frame', async () => {
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.waitFor(() => expect(clerk.codes()).toHaveLength(1));

      detectCodes.mockResolvedValue([]);

      await vi.waitFor(() => expect(clerk.codes()).toHaveLength(0));
    });

    it('ignores a code too small to be held up deliberately', async () => {
      // A barcode on a poster across the room is not being bought.
      detectCodes.mockResolvedValue([seen('BAR-p1', 0.02)]);

      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(tryAddToCart).not.toHaveBeenCalled();
    });

    it('picks the nearest code when two are in view', async () => {
      detectCodes.mockResolvedValue([seen('BAR-p2', 0.12), seen('BAR-p1', 0.45)]);

      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalledWith(AVOCADO));
    });

    it('still enforces stock on a scanned item', async () => {
      tryAddToCart.mockReturnValue({ added: false, reason: 'out-of-stock' });
      detectCodes.mockResolvedValue([seen('BAR-p1')]);

      await vi.waitFor(() => expect(clerk.caption()).toContain('out of stock'));
      expect(clerk.pendingAdd()).toBeNull();
    });

    it('lets a refused scan be retried with the item still in hand', async () => {
      tryAddToCart.mockReturnValue({ added: false, reason: 'out-of-stock' });
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalledTimes(1));

      tryAddToCart.mockReturnValue({ added: true });

      // Without releasing the gate the same code would be ignored as "still held".
      await vi.waitFor(() => expect(tryAddToCart.mock.calls.length).toBeGreaterThan(1));
    });

    it('gives a scanned item the same undo window as any other', async () => {
      detectCodes.mockResolvedValue([seen('BAR-p1')]);

      await vi.waitFor(() => expect(clerk.pendingAdd()).not.toBeNull());
      expect(clerk.pendingAdd()).toEqual({ productId: 'p1', label: 'Avocado', quantity: 1 });
    });

    it('records that the add came from a barcode', async () => {
      detectCodes.mockResolvedValue([seen('BAR-p1')]);

      await vi.waitFor(() =>
        expect(publish).toHaveBeenCalledWith(
          expect.objectContaining({
            type: EventType.CLERK_ITEM_RECOGNIZED,
            payload: expect.objectContaining({ barcode: 'BAR-p1', confidence: 1 }),
          })
        )
      );
    });

    it('stops scanning once the session closes', async () => {
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.waitFor(() => expect(clerk.codes()).toHaveLength(1));

      clerk.stop();

      expect(clerk.codes()).toHaveLength(0);
      const calls = detectCodes.mock.calls.length;
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(detectCodes).toHaveBeenCalledTimes(calls);
    });

    it('clears the boxes when the camera changes', async () => {
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.waitFor(() => expect(clerk.codes()).toHaveLength(1));
      detectCodes.mockResolvedValue([]);

      await clerk.selectCamera('cam-b');

      expect(clerk.codes()).toHaveLength(0);
    });
  });

  describe('the recognition log', () => {
    /** The single argument of the nth `record` call. */
    function recorded(index = 0): Record<string, unknown> {
      return logRecord.mock.calls[index]![0] as Record<string, unknown>;
    }

    it('records which tier answered, so accuracy can be compared per tier', async () => {
      identify.mockResolvedValue(confident());

      clerk.scanNow();

      await vi.waitFor(() => expect(logRecord).toHaveBeenCalled());
      expect(recorded()).toMatchObject({
        tier: 'model',
        proposedProductId: 'p1',
        outcome: 'auto',
      });
    });

    it('attributes a barcode scan to the barcode tier at full confidence', async () => {
      detectCodes.mockResolvedValue([
        { value: 'BAR-p1', format: 'ean_13', box: { x: 0.2, y: 0.3, width: 0.3, height: 0.2 } },
      ]);

      await vi.waitFor(() => expect(logRecord).toHaveBeenCalled());
      expect(recorded()).toMatchObject({ tier: 'barcode', confidence: 1, outcome: 'auto' });
    });

    it('revises the row to wrong when the cashier undoes the add', async () => {
      // The undo window is the cheapest available label for "that was wrong".
      identify.mockResolvedValue(confident());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.pendingAdd()).not.toBeNull());

      clerk.undoLast();

      expect(logAmend).toHaveBeenCalledWith('log-1', 'undone');
    });

    it('leaves the row alone when the add is allowed to stand', async () => {
      sampleFrame.mockReturnValue(null);
      vi.useFakeTimers();
      identify.mockResolvedValue(confident());

      clerk.scanNow();
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 500);

      // Nothing to amend: the optimistic 'auto' is now known to have been right.
      expect(logAmend).not.toHaveBeenCalled();
    });

    it('records a correction with both what was offered and what was wanted', async () => {
      // The most valuable row in the table: a known-wrong ranking with the truth
      // attached. This is what the sample index will be trained against.
      identify.mockResolvedValue(unsure());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));
      logRecord.mockClear();

      clerk.chooseCandidate(2);

      expect(recorded()).toMatchObject({
        outcome: 'corrected',
        proposedProductId: 'p2',
        actualProductId: 'p3',
      });
    });

    it('records taking the top candidate as agreement, not correction', async () => {
      identify.mockResolvedValue(unsure());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));
      logRecord.mockClear();

      clerk.chooseCandidate(1);

      expect(recorded()).toMatchObject({ outcome: 'chosen', actualProductId: 'p2' });
    });

    it('records rejecting everything offered', async () => {
      identify.mockResolvedValue(unsure());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));
      logRecord.mockClear();

      clerk.reject();

      expect(recorded()).toMatchObject({ outcome: 'rejected', candidateCount: 2 });
    });

    it('records recognising nothing, which is not the same as being wrong', async () => {
      identify.mockResolvedValue(nothing());

      clerk.scanNow();

      await vi.waitFor(() => expect(logRecord).toHaveBeenCalled());
      expect(recorded()).toMatchObject({ outcome: 'unknown', candidateCount: 0 });
    });

    it('records a stock refusal as an abstention, not a wrong answer', async () => {
      // Stock said no, which says nothing about whether the recognition was right.
      tryAddToCart.mockReturnValue({ added: false, reason: 'out-of-stock' });
      identify.mockResolvedValue(confident());

      clerk.scanNow();

      await vi.waitFor(() => expect(logRecord).toHaveBeenCalled());
      expect(recorded()).toMatchObject({ outcome: 'rejected', tier: 'model' });
    });
  });

  describe('the progress ring', () => {
    it('shows nothing while the scene is moving', async () => {
      clerk.stop();
      vi.useFakeTimers();
      let n = 0;
      sampleFrame.mockImplementation(() => new Uint8Array(16).fill((n += 90) % 255));
      await clerk.start();

      await vi.advanceTimersByTimeAsync(600);

      expect(clerk.scanProgress()).toEqual({ kind: 'hidden' });
    });

    it('fills as the scene settles', async () => {
      clerk.stop();
      vi.useFakeTimers();
      sampleFrame.mockReturnValue(new Uint8Array(16).fill(120));
      identify.mockImplementation(() => new Promise<RecognitionResult>(() => undefined));
      await clerk.start();

      await vi.advanceTimersByTimeAsync(300);
      const early = clerk.scanProgress();
      expect(early.kind).toBe('settling');

      await vi.advanceTimersByTimeAsync(500);
      const later = clerk.scanProgress();
      expect(later.kind).toBe('settling');
      if (early.kind === 'settling' && later.kind === 'settling') {
        expect(later.value).toBeGreaterThan(early.value);
      }
    });

    it('sweeps while a look is in flight, because the wait has no known length', async () => {
      identify.mockImplementation(() => new Promise<RecognitionResult>(() => undefined));

      clerk.scanNow();

      await vi.waitFor(() => expect(clerk.busy()).toBe(true));
      await vi.waitFor(() => expect(clerk.scanProgress()).toEqual({ kind: 'reading' }));
    });

    it('hides again once the session ends', () => {
      clerk.stop();
      expect(clerk.scanProgress()).toEqual({ kind: 'hidden' });
    });
  });

  describe('waiting before it pays', () => {
    /** A scene that never changes, so the frame gate has nothing to object to. */
    function holdStill(value = 120): void {
      sampleFrame.mockReturnValue(new Uint8Array(16).fill(value));
    }

    it('holds a settled scene through the debounce window before spending', async () => {
      clerk.stop();
      vi.useFakeTimers();
      holdStill();
      await clerk.start();

      // Settled, past the gate's minimum interval, and still not paid for: the gate
      // opening is a nomination, not a decision.
      await vi.advanceTimersByTimeAsync(1300);
      expect(identify).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(600);
      expect(identify).toHaveBeenCalledTimes(1);
    });

    it('reads as focusing rather than offering to look again while it waits', async () => {
      // The gate reports its cooldown through the debounce, and the HUD turns that
      // into a "Look again" button — offered for a look that is already coming.
      clerk.stop();
      vi.useFakeTimers();
      holdStill();
      await clerk.start();

      await vi.advanceTimersByTimeAsync(1300);

      expect(clerk.verdict()).toBe('holding');
      expect(clerk.scanProgress().kind).toBe('settling');
    });

    it('does not lose an item that moved again inside the window', async () => {
      clerk.stop();
      vi.useFakeTimers();
      let scene = 120;
      sampleFrame.mockImplementation(() => new Uint8Array(16).fill(scene));
      await clerk.start();
      await vi.advanceTimersByTimeAsync(1300);
      expect(identify).not.toHaveBeenCalled();

      // The hand nudges it square. Nothing was looked at, so the gate must not go on
      // holding the scene back as one it has already identified.
      scene = 30;
      await vi.advanceTimersByTimeAsync(250);
      expect(identify).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(2500);
      expect(identify).toHaveBeenCalledTimes(1);
    });

    it('looks at once when the cashier asks out loud', async () => {
      // The wait exists to find out whether they meant it. Being asked is knowing.
      clerk.scanNow();

      await vi.waitFor(() => expect(identify).toHaveBeenCalledTimes(1));
    });
  });

  describe('holding the code before it counts', () => {
    /**
     * Every one of these runs on fake timers. The dwell is three sampling ticks long
     * and the thing under test is which tick the sale lands on, so a real clock would
     * make the suite a race against the machine it happens to be running on.
     */
    async function restartWithFakeClock(): Promise<void> {
      clerk.stop();
      vi.useFakeTimers();
      await clerk.start();
    }

    it('never rings up a code that only crosses the frame', async () => {
      // A shelf label sweeping past the lens decodes perfectly, and used to sell.
      await restartWithFakeClock();
      // So a look, if one happens, cannot be what adds the item instead.
      identify.mockResolvedValue(nothing());
      detectCodes.mockResolvedValue([seen('BAR-p1')]);

      // Two ticks: read, and read again — but not held.
      await vi.advanceTimersByTimeAsync(300);
      detectCodes.mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(800);

      expect(tryAddToCart).not.toHaveBeenCalled();
    });

    it('reports the wait it is making the cashier sit through', async () => {
      await restartWithFakeClock();
      detectCodes.mockResolvedValue([seen('BAR-p1')]);

      await vi.advanceTimersByTimeAsync(300);

      const dwell = clerk.barcodeDwell();
      expect(dwell).toBeGreaterThan(0);
      expect(dwell).toBeLessThan(1);
      // And it owns the ring while it runs — the frame gate's own waits describe a
      // look this very code is standing in the way of.
      expect(clerk.scanProgress()).toEqual({ kind: 'settling', value: dwell });
    });

    it('rings it up, and stops reporting a wait, once it has been held', async () => {
      await restartWithFakeClock();
      detectCodes.mockResolvedValue([seen('BAR-p1')]);

      await vi.advanceTimersByTimeAsync(600);

      expect(tryAddToCart).toHaveBeenCalledTimes(1);
      expect(identify).not.toHaveBeenCalled();
      expect(clerk.barcodeDwell()).toBeNull();
    });

    it('drops the wait when the camera is switched off part way through', async () => {
      await restartWithFakeClock();
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.advanceTimersByTimeAsync(300);
      expect(clerk.barcodeDwell()).not.toBeNull();

      await clerk.setCameraEnabled(false);

      // A ring left filling over a camera that is off is a till that looks stuck.
      expect(clerk.barcodeDwell()).toBeNull();
    });
  });

  describe('barcode-only mode', () => {
    async function restartWithFakeClock(): Promise<void> {
      clerk.stop();
      vi.useFakeTimers();
      await clerk.start();
      clerk.setAiEnabled(false);
    }

    it('adds the product on the frame the code is read', async () => {
      // Nothing is racing the bars for this frame, so there is nothing to wait for.
      await restartWithFakeClock();
      detectCodes.mockResolvedValue([seen('BAR-p1')]);

      await vi.advanceTimersByTimeAsync(130);

      expect(tryAddToCart).toHaveBeenCalledTimes(1);
      expect(clerk.barcodeDwell()).toBeNull();
    });

    it('lets three identical items go through one after another', async () => {
      // The case that made this mode worth having: a crate of the same yoghurt.
      await restartWithFakeClock();

      for (let i = 0; i < 3; i++) {
        detectCodes.mockResolvedValue([seen('BAR-p1')]);
        await vi.advanceTimersByTimeAsync(130);
        detectCodes.mockResolvedValue([]);
        await vi.advanceTimersByTimeAsync(500);
      }

      expect(tryAddToCart).toHaveBeenCalledTimes(3);
    });

    it('still refuses to charge twice when the decoder blinks', async () => {
      // The dwell goes to zero in this mode; the absence window deliberately does
      // not, because a one-frame dropout is not a second jar.
      await restartWithFakeClock();
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.advanceTimersByTimeAsync(130);
      detectCodes.mockResolvedValue([]);
      await vi.advanceTimersByTimeAsync(130);
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.advanceTimersByTimeAsync(130);

      expect(tryAddToCart).toHaveBeenCalledTimes(1);
    });
  });

  describe('moods', () => {
    it('starts with nothing to react to', () => {
      expect(clerk.mood()).toBe(ClerkMood.NEUTRAL);
    });

    it('is pleased when an item goes in', async () => {
      detectCodes.mockResolvedValue([seen('BAR-p1')]);

      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalled());

      expect(clerk.mood()).toBe(ClerkMood.HAPPY);
    });

    it('is sorry when stock refuses one', async () => {
      tryAddToCart.mockReturnValue({ added: false, reason: 'out-of-stock' });
      detectCodes.mockResolvedValue([seen('BAR-p1')]);

      await vi.waitFor(() => expect(clerk.caption()).toContain('out of stock'));

      expect(clerk.mood()).toBe(ClerkMood.SORRY);
    });

    it('is alarmed by a code it cannot place', async () => {
      detectCodes.mockResolvedValue([seen('NOT-STOCKED')]);

      await vi.waitFor(() => expect(clerk.caption()).toContain("isn't in the catalogue"));

      expect(clerk.mood()).toBe(ClerkMood.ALERT);
    });

    it('is unsure when it cannot tell what it is looking at', async () => {
      identify.mockResolvedValue(nothing());

      await vi.waitFor(() => expect(clerk.caption()).toContain("can't tell"), { timeout: 3000 });

      expect(clerk.mood()).toBe(ClerkMood.UNSURE);
    });

    it('owns an undo as its own mistake', async () => {
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalled());

      clerk.undoLast();

      expect(clerk.mood()).toBe(ClerkMood.SORRY);
    });

    it('does not apologise for a removal the cashier asked for', async () => {
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalled());
      expect(clerk.mood()).toBe(ClerkMood.HAPPY);

      onFinalPhrase('remove the avocado');

      // Taking a line off is an ordinary edit to the sale; an apology would be noise.
      expect(clerk.mood()).toBe(ClerkMood.NEUTRAL);
    });

    it('plays the mood harder when she has no voice to use', () => {
      expect(clerk.moodIntensity()).toBe(0.55);

      clerk.setMuted(true);

      // The captions are still carrying the words, but a cashier watching their own
      // hands is not reading them.
      expect(clerk.moodIntensity()).toBe(1);
    });

    it('settles back to neutral on its own', async () => {
      clerk.stop();
      vi.useFakeTimers();
      await clerk.start();
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.advanceTimersByTimeAsync(600);
      expect(clerk.mood()).toBe(ClerkMood.HAPPY);

      await vi.advanceTimersByTimeAsync(MOOD_HOLD_MS + 200);

      // An expression that outlives what caused it has stopped describing anything.
      expect(clerk.mood()).toBe(ClerkMood.NEUTRAL);
    });

    it('settles her face when the session ends', async () => {
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await vi.waitFor(() => expect(clerk.mood()).toBe(ClerkMood.HAPPY));

      clerk.stop();

      expect(clerk.mood()).toBe(ClerkMood.NEUTRAL);
    });
  });

  describe('barcodes before the model', () => {
    it('keeps the model out of a frame a stocked barcode is already answering', async () => {
      clerk.stop();
      vi.useFakeTimers();
      let scene = 120;
      sampleFrame.mockImplementation(() => new Uint8Array(16).fill(scene));
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await clerk.start();

      await vi.advanceTimersByTimeAsync(1500);
      expect(tryAddToCart).toHaveBeenCalledWith(AVOCADO);

      // Still being held, bars still readable, but the scene has changed enough that
      // the gate no longer recognises it — which is the case claiming the scene does
      // not cover, and the one that quietly bills for what the bars said for free.
      scene = 30;
      await vi.advanceTimersByTimeAsync(2500);

      expect(identify).not.toHaveBeenCalled();
      expect(clerk.barcodePriority()).toBe(true);
    });

    it('uses its eyes once the bars have really gone', async () => {
      clerk.stop();
      vi.useFakeTimers();
      sampleFrame.mockReturnValue(new Uint8Array(16).fill(120));
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await clerk.start();
      await vi.advanceTimersByTimeAsync(1500);

      // A loose apple after a barcoded jar: nothing else can name it now.
      detectCodes.mockResolvedValue([]);
      sampleFrame.mockReturnValue(new Uint8Array(16).fill(30));
      await vi.advanceTimersByTimeAsync(3000);

      expect(identify).toHaveBeenCalledTimes(1);
      expect(clerk.barcodePriority()).toBe(false);
    });

    it('does not try to decode a frame it has no picture for', async () => {
      // Between a camera switch and the new stream arriving there is nothing to
      // decode. Handing that to the detector would ask it about a null video.
      clerk.stop();
      vi.useFakeTimers();
      detectionSource.mockReturnValue(null);
      detectCodes.mockClear();
      await clerk.start();

      await vi.advanceTimersByTimeAsync(600);

      expect(detectCodes).not.toHaveBeenCalled();
      expect(clerk.codes()).toHaveLength(0);
    });

    it('does not stand down for a code the catalogue has never heard of', async () => {
      // The catalogue may simply be missing that barcode while the product is
      // stocked, so the packaging is still worth looking at.
      clerk.stop();
      vi.useFakeTimers();
      sampleFrame.mockReturnValue(new Uint8Array(16).fill(120));
      detectCodes.mockResolvedValue([seen('NOT-STOCKED')]);
      await clerk.start();

      await vi.advanceTimersByTimeAsync(2500);

      expect(identify).toHaveBeenCalledTimes(1);
    });

    it('overrules the barcode when the cashier asks for a look', async () => {
      clerk.stop();
      vi.useFakeTimers();
      sampleFrame.mockReturnValue(new Uint8Array(16).fill(120));
      detectCodes.mockResolvedValue([seen('BAR-p1')]);
      await clerk.start();
      await vi.advanceTimersByTimeAsync(600);

      clerk.scanNow();
      await vi.advanceTimersByTimeAsync(1);

      expect(identify).toHaveBeenCalledTimes(1);
      expect(clerk.barcodePriority()).toBe(false);
    });
  });

  describe('muting her voice', () => {
    it('silences the audio and says so in text', () => {
      // The greeting was spoken before any of this, so measure from here.
      spokenAloud.length = 0;

      clerk.toggleMute();

      expect(clerk.muted()).toBe(true);
      // The confirmation still arrives, on the channel that is still open.
      expect(clerk.caption()).toContain('captioning');
      expect(spokenAloud).toHaveLength(0);
    });

    it('keeps captioning everything she would have said', async () => {
      clerk.toggleMute();
      spokenAloud.length = 0;

      clerk.scanNow();

      await vi.waitFor(() => expect(clerk.caption()).toBe('One avocado, added.'));
      expect(tryAddToCart).toHaveBeenCalledWith(AVOCADO);
      expect(spokenAloud).toHaveLength(0);
    });

    it('speaks the confirmation when the voice comes back', () => {
      clerk.toggleMute();

      clerk.toggleMute();

      expect(clerk.muted()).toBe(false);
      expect(spokenAloud).toContain('Voice back on.');
    });

    it('ignores being muted twice', () => {
      clerk.setMuted(true);
      const captioned = clerk.caption();

      clerk.setMuted(true);

      expect(clerk.caption()).toBe(captioned);
    });

    it('is asked for by voice, without closing the microphone', () => {
      clerk.toggleMic();

      onFinalPhrase('be quiet please');

      expect(clerk.muted()).toBe(true);
      // Muting her is not the same as deafening her: the next spoken command still
      // has to land, and the mic is the only way it can.
      expect(clerk.micEnabled()).toBe(true);
      expect(earStop).not.toHaveBeenCalled();
    });

    it('gives the voice back when asked', () => {
      clerk.setMuted(true);

      onFinalPhrase('unmute');

      expect(clerk.muted()).toBe(false);
    });

    it('closes the microphone when told to stop listening, and leaves it closed', () => {
      clerk.toggleMic();

      onFinalPhrase('stop listening');
      expect(clerk.micEnabled()).toBe(false);

      // "Start listening" into a microphone that is off cannot be heard, so a second
      // phrase must not toggle it back on — that reading would make any stray word
      // reopen a mic the cashier deliberately closed.
      onFinalPhrase('stop listening');
      expect(clerk.micEnabled()).toBe(false);
    });
  });

  describe('the rest of the spoken vocabulary', () => {
    it('rejects the options on a spoken no', async () => {
      identify.mockResolvedValue(unsure());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));

      onFinalPhrase('no, none of those');

      expect(clerk.awaitingChoice()).toBe(false);
      expect(clerk.caption()).toBe('Show me again.');
    });

    it('switches the camera off when asked, without ending the session', async () => {
      onFinalPhrase('turn the camera off');

      await vi.waitFor(() => expect(clerk.cameraEnabled()).toBe(false));
      expect(clerk.phase()).toBe('ready');
    });

    it('stops guessing when asked, and starts again when asked', () => {
      onFinalPhrase('barcodes only');
      expect(clerk.aiEnabled()).toBe(false);

      onFinalPhrase('recognition on');
      expect(clerk.aiEnabled()).toBe(true);
    });

    it('looks again when asked out loud', async () => {
      onFinalPhrase('have another look');

      await vi.waitFor(() => expect(identify).toHaveBeenCalled());
    });

    it('will not guess when a spoken name fits both options on screen', async () => {
      // "Which one?" answered with a word that fits both is not an answer, and
      // picking the first would charge for an item nobody named.
      clerk.stop();
      const soy = product('c2', 'Soy Milk');
      getActiveProducts.mockResolvedValue([OAT_MILK, soy]);
      identify.mockResolvedValue({
        candidates: [
          { productId: 'p2', label: 'Oat Milk', confidence: 0.74 },
          { productId: 'c2', label: 'Soy Milk', confidence: 0.71 },
        ],
        utterance: 'Which one is it?',
        empty: false,
      });
      await clerk.start();
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));

      onFinalPhrase('add milk');

      expect(tryAddToCart).not.toHaveBeenCalled();
      expect(clerk.caption()).toContain('Which one?');
    });

    it('says which kind of miss a removal was, on the bus as well as out loud', () => {
      cartItems.set([{ product: OAT_MILK, quantity: 1 }]);

      // Stocked, but not in this sale.
      onFinalPhrase('remove the avocado');
      expect(clerk.caption()).toContain('no avocado in the cart');
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: EventType.CLERK_ITEM_REJECTED,
          payload: expect.objectContaining({ reason: 'not-in-cart' }),
        })
      );

      // Not stocked at all, which is a different thing to check.
      onFinalPhrase('remove the caviar');
      expect(clerk.caption()).toContain('in the catalogue');
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ reason: 'unknown-spoken-name' }),
        })
      );
    });
  });

  describe('what the recognition log is not charged for', () => {
    it('does not score the recognizer when the cashier picks from a spoken ambiguity', async () => {
      // Nothing was proposed by a recognizer, so there is no ranking to be right or
      // wrong about — a row here would drag the model's accuracy down for work it
      // never did.
      clerk.stop();
      getActiveProducts.mockResolvedValue([product('c1', 'Coffee'), product('c2', 'Coffee Beans')]);
      await clerk.start();

      onFinalPhrase('add a coffee');
      expect(clerk.candidateCards().length).toBeGreaterThan(1);
      logRecord.mockClear();

      clerk.chooseCandidate(1);

      expect(tryAddToCart).toHaveBeenCalled();
      expect(logRecord).not.toHaveBeenCalled();
    });

    it('does not score the recognizer when a spoken ambiguity is rejected outright', async () => {
      clerk.stop();
      getActiveProducts.mockResolvedValue([product('c1', 'Coffee'), product('c2', 'Coffee Beans')]);
      await clerk.start();

      onFinalPhrase('add a coffee');
      logRecord.mockClear();

      clerk.reject();

      expect(logRecord).not.toHaveBeenCalled();
      expect(clerk.awaitingChoice()).toBe(false);
    });

    it('goes back to idle when an undo window closes on a found pose', async () => {
      vi.useFakeTimers();
      clerk.scanNow();
      await vi.advanceTimersByTimeAsync(1);
      expect(clerk.visualState()).toBe('found');

      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 500);

      // A face still lit up over an item nobody can undo any more is a lie.
      expect(clerk.visualState()).toBe('idle');
    });
  });

  describe('refusals, misses and the states nobody plans for', () => {
    it('says the cart is empty when asked to take something off an empty sale', () => {
      cartItems.set([]);

      onFinalPhrase('remove the avocado');

      expect(clerk.caption()).toBe('The cart is empty.');
      expect(decreaseQuantity).not.toHaveBeenCalled();
    });

    it('asks which one when two things in the cart answer to the same word', () => {
      // Deliberately a question rather than the candidate cards: pressing a card
      // adds, which is the opposite of what was asked.
      cartItems.set([
        { product: OAT_MILK, quantity: 1 },
        { product: product('p4', 'Soy Milk'), quantity: 1 },
      ]);

      onFinalPhrase('remove the milk');

      expect(clerk.caption()).toContain('Which one?');
      expect(clerk.caption()).toContain('oat milk');
      expect(decreaseQuantity).not.toHaveBeenCalled();
      expect(removeFromCart).not.toHaveBeenCalled();
    });

    it('takes off only as many as were asked for when more are in the cart', () => {
      cartItems.set([{ product: AVOCADO, quantity: 3 }]);

      onFinalPhrase('remove one avocado');

      expect(decreaseQuantity).toHaveBeenCalledTimes(1);
      // The line survives, so it must not be dropped wholesale.
      expect(removeFromCart).not.toHaveBeenCalled();
    });

    it('answers rather than throwing when the line and its quantity disagree', () => {
      // `decreaseQuantity` throws once the line is gone, and this runs inside a
      // speech callback where a thrown error is swallowed and reads as silence.
      cartItems.set([{ product: AVOCADO, quantity: 1 }]);
      getQuantity.mockReturnValue(0);

      onFinalPhrase('remove the avocado');

      expect(clerk.caption()).toContain('no avocado in the cart');
      expect(decreaseQuantity).not.toHaveBeenCalled();
      expect(removeFromCart).not.toHaveBeenCalled();
    });

    it('leaves the undo window alone when a different item is taken off', () => {
      cartItems.set([
        { product: AVOCADO, quantity: 1 },
        { product: OAT_MILK, quantity: 1 },
      ]);
      onFinalPhrase('add an avocado');
      expect(clerk.pendingAdd()?.productId).toBe('p1');

      onFinalPhrase('remove the oat milk');

      // The window still describes a line that is still there.
      expect(clerk.pendingAdd()?.productId).toBe('p1');
    });

    it('says the item is already gone rather than throwing on a stale undo', async () => {
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.pendingAdd()).not.toBeNull());
      // A checkout, or a spoken removal, emptied the line the window refers to.
      cartItems.set([]);
      decreaseQuantity.mockClear();

      clerk.undoLast();

      expect(clerk.caption()).toContain('already off the sale');
      expect(decreaseQuantity).not.toHaveBeenCalled();
      expect(clerk.pendingAdd()).toBeNull();
    });

    it('does not revise a recognizer row when undoing something the cashier named', () => {
      // There is no row to revise: nothing was proposed, so nothing was wrong.
      onFinalPhrase('add an avocado');
      logAmend.mockClear();

      clerk.undoLast();

      expect(logAmend).not.toHaveBeenCalled();
    });

    it('reads a plural that needs more than an s', async () => {
      // "2 peachs" is the kind of detail that makes a voice sound broken.
      clerk.stop();
      getActiveProducts.mockResolvedValue([product('p6', 'Peach')]);
      await clerk.start();

      onFinalPhrase('add two peaches');

      expect(clerk.caption()).toBe('2 peaches, added.');
    });

    it("keeps a deliberate barcode from being shadowed by another product's SKU", async () => {
      clerk.stop();
      const jam = coded('p7', 'Jam', 'JAM-SKU', 'DUP-1');
      const shelfLabel = coded('p8', 'Shelf Label', 'DUP-1', 'LABEL-BAR');
      getActiveProducts.mockResolvedValue([jam, shelfLabel]);
      await clerk.start();

      detectCodes.mockResolvedValue([seen('DUP-1')]);

      // First writer wins: the barcode was registered before the colliding SKU.
      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalledWith(jam));
    });

    it('drops boxes that were decoded after the session ended', async () => {
      let release: (codes: ScannedCode[]) => void = () => undefined;
      detectCodes.mockImplementation(
        () => new Promise<ScannedCode[]>((resolve) => (release = resolve))
      );
      await vi.waitFor(() => expect(detectCodes).toHaveBeenCalled());

      clerk.stop();
      release([seen('BAR-p1')]);
      await Promise.resolve();

      // Those brackets belong to a frame that no longer exists, and that item
      // belongs to a sale nobody is making.
      expect(clerk.codes()).toHaveLength(0);
      expect(tryAddToCart).not.toHaveBeenCalled();
    });

    it('rings the sale up even when telemetry is broken', async () => {
      // The agent-monitor dashboard is useful; it is not worth failing a sale over.
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      recordCounter.mockImplementation(() => {
        throw new Error('exporter down');
      });

      clerk.scanNow();

      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalledWith(AVOCADO));
      expect(warn).toHaveBeenCalled();
    });

    it('ignores being told twice to stop guessing', () => {
      clerk.setAiEnabled(false);
      const said = clerk.caption();

      clerk.setAiEnabled(false);

      // No second announcement, and nothing else re-run.
      expect(clerk.caption()).toBe(said);
    });

    it('ignores being told twice to switch the camera off', async () => {
      await clerk.setCameraEnabled(false);
      cameraPause.mockClear();

      await clerk.setCameraEnabled(false);

      expect(cameraPause).not.toHaveBeenCalled();
    });

    it('will not switch the camera before the session is running', async () => {
      clerk.stop();
      cameraPause.mockClear();

      await clerk.setCameraEnabled(false);

      expect(cameraPause).not.toHaveBeenCalled();
    });

    it('will not cycle cameras while the camera is off, which would reopen one', async () => {
      await clerk.setCameraEnabled(false);
      selectCamera.mockClear();

      await clerk.cycleCamera();

      expect(selectCamera).not.toHaveBeenCalled();
    });
  });

  describe('choosing a camera', () => {
    it('exposes the cameras and which one is live', () => {
      expect(clerk.cameras().map((camera) => camera.label)).toEqual(['Overhead', 'Shelf']);
      expect(clerk.activeCameraId()).toBe('cam-a');
      expect(clerk.hasCameraChoice()).toBe(true);
    });

    it('switches camera and says which one it is now using', async () => {
      await clerk.selectCamera('cam-b');

      expect(selectCamera).toHaveBeenCalledWith('cam-b');
      expect(clerk.activeCameraId()).toBe('cam-b');
      expect(clerk.caption()).toBe('Looking through Shelf.');
    });

    it('does nothing when asked for the camera already in use', async () => {
      await clerk.selectCamera('cam-a');

      expect(selectCamera).not.toHaveBeenCalled();
    });

    it('does nothing before the session is running', async () => {
      clerk.stop();

      await clerk.selectCamera('cam-b');

      expect(selectCamera).not.toHaveBeenCalled();
    });

    it('drops unanswered options, because they belonged to the old angle', async () => {
      identify.mockResolvedValue(unsure());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));

      await clerk.selectCamera('cam-b');

      expect(clerk.awaitingChoice()).toBe(false);
    });

    it('abandons a look already on the wire', async () => {
      // Its frame came from the camera we are leaving; acting on the answer would
      // add whatever the previous angle happened to be pointed at.
      let release: (result: RecognitionResult) => void = () => undefined;
      identify.mockImplementation(
        () => new Promise<RecognitionResult>((resolve) => (release = resolve))
      );
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.busy()).toBe(true));

      await clerk.selectCamera('cam-b');
      release(confident());
      await Promise.resolve();

      expect(tryAddToCart).not.toHaveBeenCalled();
    });

    it('looks again at a scene the other camera had already identified', async () => {
      // The frame gate refuses to re-read a scene it has already named. Carried
      // across a switch, that would make the new camera silently ignore the item
      // sitting in front of it.
      //
      // Driven through the real scan loop on purpose: `scanNow` clears the gate
      // itself, so testing this via `scanNow` would pass whether or not the switch
      // resets anything.
      clerk.stop();
      vi.useFakeTimers();
      sampleFrame.mockReturnValue(new Uint8Array(16).fill(120));
      identify.mockResolvedValue(confident());
      await clerk.start();

      await vi.advanceTimersByTimeAsync(2000);
      expect(identify).toHaveBeenCalledTimes(1);

      await clerk.selectCamera('cam-b');
      await vi.advanceTimersByTimeAsync(3000);

      expect(identify).toHaveBeenCalledTimes(2);
    });

    it('says so when a camera will not open, and keeps working', async () => {
      selectCamera.mockResolvedValue(false);

      await clerk.selectCamera('cam-b');

      expect(clerk.caption()).toBe("That camera wouldn't open.");
      expect(clerk.phase()).toBe('ready');
    });

    it('cycles to the next camera and wraps around', async () => {
      await clerk.cycleCamera();
      expect(clerk.activeCameraId()).toBe('cam-b');

      await clerk.cycleCamera();
      expect(clerk.activeCameraId()).toBe('cam-a');
    });

    it('does not restart the stream when there is only one camera', async () => {
      cameras.set([{ deviceId: 'cam-a', label: 'Overhead' }]);

      await clerk.cycleCamera();

      expect(selectCamera).not.toHaveBeenCalled();
      expect(clerk.hasCameraChoice()).toBe(false);
    });

    it('holds the scan loop while the stream swaps', async () => {
      // Between aborting the old look and the old stream stopping there is a
      // window where a tick could capture from the camera being left behind.
      let finishSwitch: (ok: boolean) => void = () => undefined;
      selectCamera.mockImplementation(() => new Promise<boolean>((r) => (finishSwitch = r)));

      const switching = clerk.selectCamera('cam-b');
      expect(clerk.busy()).toBe(true);

      finishSwitch(true);
      await switching;
      expect(clerk.busy()).toBe(false);
    });
  });

  describe('stopping', () => {
    it('releases the camera and the microphone and resets the pose', async () => {
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.pendingAdd()).not.toBeNull());

      clerk.stop();

      expect(earStop).toHaveBeenCalled();
      expect(cancelSpeech).toHaveBeenCalled();
      expect(clerk.phase()).toBe('off');
      expect(clerk.pendingAdd()).toBeNull();
      expect(clerk.micEnabled()).toBe(false);
      expect(clerk.visualState()).toBe('idle');
    });
  });

  describe('the confidence reading', () => {
    it('reports what it is looking at now, not the last thing it read', async () => {
      // The yuzu is driven by this. A stale reading leaves the fruit ripe and
      // glowing over an empty counter.
      sampleFrame.mockReturnValue(null);
      vi.useFakeTimers();
      identify.mockResolvedValue(confident());

      clerk.scanNow();
      await vi.advanceTimersByTimeAsync(1);
      expect(clerk.confidence()).toBeGreaterThan(0.9);

      await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 500);
      expect(clerk.confidence()).toBe(0);
      expect(clerk.visualState()).toBe('idle');
    });

    it('clears the reading on undo', async () => {
      identify.mockResolvedValue(confident());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.pendingAdd()).not.toBeNull());

      clerk.undoLast();

      expect(clerk.confidence()).toBe(0);
    });

    it('clears the reading when the options are all rejected', async () => {
      identify.mockResolvedValue(unsure());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));

      clerk.reject();

      expect(clerk.confidence()).toBe(0);
    });
  });

  describe('the confidence thresholds', () => {
    it('acts at the threshold and asks just below it', async () => {
      identify.mockResolvedValue({
        candidates: [{ productId: 'p1', label: 'Avocado', confidence: AUTO_ADD_CONFIDENCE }],
        utterance: 'One avocado, added.',
        empty: false,
      });
      clerk.scanNow();
      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalled());

      tryAddToCart.mockClear();
      identify.mockResolvedValue({
        candidates: [{ productId: 'p1', label: 'Avocado', confidence: AUTO_ADD_CONFIDENCE - 0.01 }],
        utterance: 'Is it the avocado?',
        empty: false,
      });
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));
      expect(tryAddToCart).not.toHaveBeenCalled();
    });
  });

  describe('ringing up by voice', () => {
    it('adds a product the cashier names out loud', () => {
      // The bug this feature exists for: saying the name of something used to do
      // nothing at all, because names were only ever matched against the two or
      // three candidates already on screen.
      onFinalPhrase('add a sourdough');
      expect(tryAddToCart).toHaveBeenCalledWith(SOURDOUGH);
      expect(clerk.caption()).toBe('One sourdough, added.');
    });

    it('adds as many as were asked for', () => {
      tryAddToCart.mockClear();
      onFinalPhrase('add three sourdoughs');
      // Three separate adds, so stock is checked three times rather than once.
      expect(tryAddToCart).toHaveBeenCalledTimes(3);
      expect(clerk.caption()).toBe('3 sourdoughs, added.');
    });

    it('adds what stock allows and says it fell short', () => {
      let calls = 0;
      tryAddToCart.mockImplementation(() =>
        ++calls <= 2 ? { added: true } : { added: false, reason: 'out-of-stock' }
      );
      onFinalPhrase('add five sourdoughs');
      expect(calls).toBe(3);
      expect(clerk.caption()).toContain('Only 2');
    });

    it('does not score the recognizer for an item the cashier named', () => {
      // The log measures how good the *camera* is. A spoken add is the cashier
      // telling the till, so a row here would drag the tier's accuracy down for
      // work no recognizer did.
      logRecord.mockClear();
      onFinalPhrase('add a sourdough');
      expect(logRecord).not.toHaveBeenCalled();
    });

    it('offers a choice when the name fits more than one product', async () => {
      clerk.stop();
      getActiveProducts.mockResolvedValue([product('m1', 'Oat Milk'), product('m2', 'Soy Milk')]);
      await clerk.start();
      tryAddToCart.mockClear();

      onFinalPhrase('add a milk');

      // "milk" does not distinguish them, so nothing is charged for until the
      // cashier says which — the same cards the camera path uses.
      expect(tryAddToCart).not.toHaveBeenCalled();
      expect(clerk.candidateCards().map((card) => card.label)).toEqual(['Oat Milk', 'Soy Milk']);
    });

    it('answers a name it does not stock instead of going quiet', () => {
      onFinalPhrase('add a pineapple');
      expect(tryAddToCart).not.toHaveBeenCalled();
      expect(clerk.caption()).toContain('pineapple');
    });

    it('treats naming one of the candidates on screen as answering the question', async () => {
      identify.mockResolvedValue(unsure());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.candidateCards().length).toBeGreaterThan(1));
      logRecord.mockClear();

      onFinalPhrase('add the oat milk');

      // Routed through the choice, not the catalog, so the row that says whether
      // the recognizer ranked it correctly still gets written.
      expect(logRecord).toHaveBeenCalled();
      expect(clerk.candidateCards()).toEqual([]);
    });
  });

  describe('taking things off by voice', () => {
    beforeEach(() => {
      onFinalPhrase('add a sourdough');
    });

    it('removes a named item', () => {
      onFinalPhrase('remove the sourdough');
      expect(cartItems()).toEqual([]);
      expect(clerk.caption()).toBe('One sourdough removed.');
    });

    it('never takes off more than the cart holds', () => {
      onFinalPhrase('remove three sourdoughs');
      // One in the cart, so the line goes rather than three decrements running off
      // the end — `decreaseQuantity` throws once the line is gone.
      expect(removeFromCart).toHaveBeenCalledWith('p3');
      expect(decreaseQuantity).not.toHaveBeenCalled();
    });

    it('says which kind of miss it was rather than throwing', () => {
      onFinalPhrase('remove the avocado');
      expect(decreaseQuantity).not.toHaveBeenCalled();
      expect(removeFromCart).not.toHaveBeenCalled();
      // Stocked but not rung up, which is a different fix from "we don't sell it".
      expect(clerk.caption()).toBe("There's no avocado in the cart.");
    });

    it('closes the undo window it just invalidated', () => {
      expect(clerk.pendingAdd()).not.toBeNull();
      onFinalPhrase('remove the sourdough');
      // Otherwise Undo stays on screen offering to decrement a line that is gone.
      expect(clerk.pendingAdd()).toBeNull();
    });

    it('reports the removal on the bus, which a bare decrement never does', () => {
      publish.mockClear();
      onFinalPhrase('remove the sourdough');
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({ type: EventType.CLERK_ITEM_REMOVED })
      );
    });

    it('answers a request to empty the cart instead of hunting for a product', () => {
      onFinalPhrase('clear the cart');
      expect(removeFromCart).not.toHaveBeenCalled();
      expect(clerk.caption()).toContain("can't clear the whole cart");
    });

    it('says something when there is nothing left to undo', () => {
      onFinalPhrase('remove the sourdough');
      onFinalPhrase('undo');
      // Same class of bug as the one being fixed: a control that does nothing is
      // indistinguishable from a broken one.
      expect(clerk.caption()).toContain('Nothing to undo');
    });
  });

  describe('the recognition switch', () => {
    it('stops paying the model while barcodes carry on', async () => {
      identify.mockClear();
      detectCodes.mockClear();

      clerk.toggleAi();

      expect(clerk.aiEnabled()).toBe(false);
      // The camera stays live: a barcode still needs a picture to be read from.
      expect(clerk.cameraEnabled()).toBe(true);
      expect(cameraPause).not.toHaveBeenCalled();
      // Barcode detection is still being asked for; the model is not.
      await vi.waitFor(() => expect(detectCodes).toHaveBeenCalled());
      expect(identify).not.toHaveBeenCalled();
    });

    it('still rings up a barcode with recognition off', async () => {
      clerk.toggleAi();
      tryAddToCart.mockClear();
      detectCodes.mockResolvedValue([
        { value: 'BAR-p1', format: 'ean_13', box: { x: 0.2, y: 0.3, width: 0.3, height: 0.2 } },
      ]);

      await vi.waitFor(() => expect(tryAddToCart).toHaveBeenCalledWith(AVOCADO));
      expect(identify).not.toHaveBeenCalled();
    });

    it('says it cannot name anything when the browser has no barcode reader either', () => {
      barcodeSupported.set(false);
      clerk.toggleAi();
      // Otherwise this setting silently turns the till into a screen that does
      // nothing, and the cashier finds out while holding an apple.
      expect(clerk.caption()).toContain("can't read barcodes");
    });

    it('drops an answer that arrived after being told to stop guessing', async () => {
      let release: (value: RecognitionResult) => void = () => undefined;
      identify.mockReturnValue(
        new Promise<RecognitionResult>((resolve) => {
          release = resolve;
        })
      );
      clerk.scanNow();
      await vi.waitFor(() => expect(identify).toHaveBeenCalled());
      tryAddToCart.mockClear();

      clerk.toggleAi();
      release(confident());
      await Promise.resolve();

      // The frame it describes predates the decision to stop.
      expect(tryAddToCart).not.toHaveBeenCalled();
    });

    it('explains itself rather than looking broken when asked to look again', () => {
      clerk.toggleAi();
      captureFrame.mockClear();
      clerk.scanNow();
      expect(captureFrame).not.toHaveBeenCalled();
      expect(clerk.caption()).toContain('Recognition is off');
    });

    it('comes back on and looks at the scene it was told to ignore', () => {
      clerk.toggleAi();
      clerk.toggleAi();
      expect(clerk.aiEnabled()).toBe(true);
      expect(clerk.caption()).toContain('Recognition on');
    });
  });

  describe('the camera switch', () => {
    it('lets go of the camera without ending the session', async () => {
      clerk.toggleMic();
      await clerk.toggleCamera();

      expect(cameraPause).toHaveBeenCalled();
      expect(clerk.cameraEnabled()).toBe(false);
      // The point of the whole feature: blind, but still open for business.
      expect(clerk.phase()).toBe('ready');
      expect(clerk.micEnabled()).toBe(true);
    });

    it('still rings up spoken items with the camera off', async () => {
      await clerk.toggleCamera();
      tryAddToCart.mockClear();

      onFinalPhrase('add a sourdough');

      expect(tryAddToCart).toHaveBeenCalledWith(SOURDOUGH);
    });

    it('reopens the camera that was live, not the saved favourite', async () => {
      await clerk.toggleCamera();
      await clerk.toggleCamera();
      expect(cameraResume).toHaveBeenCalled();
      expect(cameraStart).toHaveBeenCalledTimes(1);
      expect(clerk.cameraEnabled()).toBe(true);
    });

    it('keeps the session alive when the camera will not come back', async () => {
      await clerk.toggleCamera();
      cameraResume.mockResolvedValue(false);

      await clerk.toggleCamera();

      // 'blocked' would throw up the terminal overlay and end a session the
      // operator only meant to un-pause.
      expect(clerk.phase()).toBe('ready');
      expect(clerk.cameraEnabled()).toBe(false);
    });

    it('refuses to switch cameras while it is off, which would reopen one', async () => {
      await clerk.toggleCamera();
      await clerk.selectCamera('cam-b');
      expect(selectCamera).not.toHaveBeenCalled();
    });

    it('says the camera is off rather than silently not looking', async () => {
      await clerk.toggleCamera();
      clerk.scanNow();
      expect(captureFrame).not.toHaveBeenCalled();
      expect(clerk.caption()).toContain('camera is off');
    });
  });

  describe('who confirmed the choice', () => {
    /** Two model candidates on screen, so `candidateOrigin` is 'model'. */
    async function offerTwo(): Promise<void> {
      identify.mockResolvedValue(unsure());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));
      logRecord.mockClear();
      tryAddToCart.mockClear();
    }

    it('writes the recognizer ground-truth row when the cashier names a card', async () => {
      await offerTwo();

      // Card 1 is Oat Milk, card 2 is Sourdough: naming the second one is the most
      // valuable row the log has, a known-wrong ranking with the truth attached.
      const outcome = seam(clerk).addByName(['sourdough'], 1);

      expect(logRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: 'model',
          outcome: 'corrected',
          proposedProductId: 'p2',
          actualProductId: 'p3',
        })
      );
      expect(outcome).toEqual({ added: 1, wanted: 1, name: 'Sourdough' });
      expect(tryAddToCart).toHaveBeenCalledTimes(1);
      expect(clerk.pendingAdd()).toMatchObject({ productId: 'p3', quantity: 1 });
    });

    it('scores the confirm control as agreement with the ranking', async () => {
      await offerTwo();

      clerk.confirmTop();

      expect(logRecord).toHaveBeenCalledWith(
        expect.objectContaining({ outcome: 'chosen', actualProductId: 'p2' })
      );
    });

    it('writes no row at all when an agent confirmed the same match', async () => {
      await offerTwo();

      const outcome = seam(clerk).addByName(['sourdough'], 1, 'agent');

      // Not a filtered row and not a differently-tagged row: none. A 'chosen' or
      // 'corrected' row here would claim a human agreed with the camera, and would
      // move the accuracy figure the recognizer is judged by on evidence nobody gave.
      expect(logRecord).not.toHaveBeenCalled();
      // The add row is suppressed with it, so a `tier: 'model'` row cannot be left
      // behind by the very choice that was refused a row.
      expect(logRecord.mock.calls).toEqual([]);
      // The sale itself is untouched: this gate is about the audit trail, not about
      // refusing to serve the customer.
      expect(outcome).toEqual({ added: 1, wanted: 1, name: 'Sourdough' });
      expect(tryAddToCart).toHaveBeenCalledTimes(1);
      expect(clerk.pendingAdd()).toMatchObject({ productId: 'p3', quantity: 1 });
    });

    it('leaves no open log row for a later undo to amend', async () => {
      await offerTwo();
      logAmend.mockClear();

      seam(clerk).addByName(['sourdough'], 1, 'agent');
      clerk.undoLast();

      // Without this the undo would amend whichever row happened to be open — a
      // foreign row, belonging to a different add.
      expect(logAmend).not.toHaveBeenCalled();
    });

    it('still writes nothing for a voice-proposed choice, exactly as before', async () => {
      clerk.stop();
      getActiveProducts.mockResolvedValue([product('m1', 'Oat Milk'), product('m2', 'Soy Milk')]);
      await clerk.start();
      onFinalPhrase('add a milk');
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));
      logRecord.mockClear();

      clerk.chooseCandidate(2);

      // The cards came from the cashier naming a thing, so there is no ranking to
      // score — unchanged by this story, and asserted so it stays that way.
      expect(logRecord).not.toHaveBeenCalled();
    });
  });

  describe('structural quantity bounds', () => {
    it('adds one unit for a misheard count instead of draining the shelf', () => {
      tryAddToCart.mockClear();

      const outcome = seam(clerk).addByName(['sourdough'], NaN);

      // The old guard was `added >= wanted`, permanently false against NaN, so this
      // loop ran until stock refused — the whole shelf, from one utterance.
      expect(tryAddToCart).toHaveBeenCalledTimes(1);
      expect(outcome).toEqual({ added: 1, wanted: 1, name: 'Sourdough' });
      expect(clerk.caption()).toBe('One sourdough, added.');
    });

    it('floors a fractional count to whole units', () => {
      tryAddToCart.mockClear();
      seam(clerk).addByName(['sourdough'], 2.7);
      expect(tryAddToCart).toHaveBeenCalledTimes(2);
    });

    it('caps an oversized count at the spoken maximum, reversibly', () => {
      tryAddToCart.mockClear();

      seam(clerk).addByName(['sourdough'], 40);

      expect(tryAddToCart).toHaveBeenCalledTimes(MAX_SPOKEN_QUANTITY);
      // One undo window covering all five, so the whole add comes back in one action.
      expect(clerk.pendingAdd()).toMatchObject({ quantity: MAX_SPOKEN_QUANTITY });
    });

    it('removes one unit for a misheard count instead of silently nothing', () => {
      onFinalPhrase('add three sourdoughs');
      decreaseQuantity.mockClear();

      seam(clerk).removeByName(['sourdough'], NaN);

      // `Math.min(NaN, inCart)` was NaN, so `removing >= inCart` was false and the
      // `for` loop body never ran — a no-op that looked like not being heard.
      expect(decreaseQuantity).toHaveBeenCalledTimes(1);
      expect(getQuantity('p3')).toBe(2);
    });

    it('still reports a short count after the clamp', () => {
      let calls = 0;
      tryAddToCart.mockImplementation(() =>
        ++calls <= 2 ? { added: true } : { added: false, reason: 'out-of-stock' }
      );

      const outcome = seam(clerk).addByName(['sourdough'], 40);

      expect(outcome).toEqual({
        added: 2,
        wanted: MAX_SPOKEN_QUANTITY,
        name: 'Sourdough',
        reason: 'out-of-stock',
      });
      expect(clerk.caption()).toContain('Only 2');
    });
  });

  describe('what the write path reports', () => {
    it('reports the whole count on a full add', () => {
      expect(seam(clerk).addByName(['sourdough'], 3)).toEqual({
        added: 3,
        wanted: 3,
        name: 'Sourdough',
      });
    });

    it('reports both numbers and the stock reason on a short add', () => {
      let calls = 0;
      tryAddToCart.mockImplementation(() =>
        ++calls <= 2 ? { added: true } : { added: false, reason: 'max-stock-reached' }
      );

      // The case a boolean cannot express, and the one a caller most needs to be
      // honest about: neither a success nor a failure.
      expect(seam(clerk).addByName(['sourdough'], 5)).toEqual({
        added: 2,
        wanted: 5,
        name: 'Sourdough',
        reason: 'max-stock-reached',
      });
    });

    it('reports zero and why rather than a bare false', () => {
      tryAddToCart.mockReturnValue({ added: false, reason: 'out-of-stock' });

      expect(seam(clerk).addByName(['sourdough'], 1)).toEqual({
        added: 0,
        wanted: 1,
        name: 'Sourdough',
        reason: 'out-of-stock',
      });
    });

    it('shows the clamp in the outcome rather than hiding it inside', () => {
      // Asked for 40, told 5 — so a caller can see it was clamped instead of
      // believing it was fully served.
      expect(seam(clerk).addByName(['sourdough'], 40)).toEqual({
        added: MAX_SPOKEN_QUANTITY,
        wanted: MAX_SPOKEN_QUANTITY,
        name: 'Sourdough',
      });
    });

    it('distinguishes a name it does not stock from one that fits several', async () => {
      expect(seam(clerk).addByName(['pineapple'], 1)).toEqual({
        added: 0,
        wanted: 1,
        name: '',
        reason: 'unknown-name',
      });

      clerk.stop();
      getActiveProducts.mockResolvedValue([product('m1', 'Oat Milk'), product('m2', 'Soy Milk')]);
      await clerk.start();
      tryAddToCart.mockClear();

      expect(seam(clerk).addByName(['milk'], 1)).toEqual({
        added: 0,
        wanted: 1,
        name: '',
        reason: 'ambiguous',
      });
      // Nothing charged for, and the tied products are on screen as a choice.
      expect(tryAddToCart).not.toHaveBeenCalled();
      expect(clerk.candidateCards().map((card) => card.label)).toEqual(['Oat Milk', 'Soy Milk']);
    });

    it('reports an id that no longer matches a product', async () => {
      identify.mockResolvedValue(unsure());
      clerk.scanNow();
      await vi.waitFor(() => expect(clerk.awaitingChoice()).toBe(true));
      // The catalog is reloaded without the candidate's product, which is what a
      // mid-session catalog change looks like from here.
      clerk.stop();
      getActiveProducts.mockResolvedValue([AVOCADO]);
      await clerk.start();

      expect(seam(clerk).addByName(['pineapple'], 1).reason).toBe('unknown-name');
    });

    it('mirrors the outcome on removal', () => {
      onFinalPhrase('add three sourdoughs');

      expect(seam(clerk).removeByName(['sourdough'], 2)).toEqual({
        removed: 2,
        wanted: 2,
        name: 'Sourdough',
      });
    });

    it('names the product when the cart holds none of it', () => {
      onFinalPhrase('add a sourdough');
      // In the cart list but at zero on hand — the arm that exists because
      // `decreaseQuantity` throws on an absent line.
      getQuantity.mockReturnValue(0);
      decreaseQuantity.mockClear();
      removeFromCart.mockClear();

      expect(seam(clerk).removeByName(['sourdough'], 1)).toEqual({
        removed: 0,
        wanted: 1,
        name: 'Sourdough',
        reason: 'not-in-cart',
      });
      expect(decreaseQuantity).not.toHaveBeenCalled();
      expect(removeFromCart).not.toHaveBeenCalled();
    });

    it('reports an empty cart as nothing to take off', () => {
      expect(seam(clerk).removeByName(['sourdough'], 1)).toEqual({
        removed: 0,
        wanted: 1,
        name: '',
        reason: 'not-in-cart',
      });
    });

    it('separates a removal it does not stock from one merely not rung up', () => {
      onFinalPhrase('add a sourdough');

      // Two different failures with two different fixes.
      expect(seam(clerk).removeByName(['pineapple'], 1).reason).toBe('unknown-name');
      expect(seam(clerk).removeByName(['avocado'], 1).reason).toBe('not-in-cart');
    });

    it('reports an ambiguous removal without touching the cart', async () => {
      // A cart of two milks, because ambiguity is a property of the *cart* here and
      // the default catalogue cannot produce one: matching is on whole words, so
      // Avocado, Oat Milk and Sourdough share none. 'milk' appears in both of these
      // names, so it scores each of them once and covers half of each — equal score
      // and equal coverage, which is the tie this arm exists for.
      clerk.stop();
      getActiveProducts.mockResolvedValue([product('m1', 'Oat Milk'), product('m2', 'Soy Milk')]);
      await clerk.start();
      onFinalPhrase('add an oat milk');
      onFinalPhrase('add a soy milk');
      decreaseQuantity.mockClear();
      removeFromCart.mockClear();

      // Deliberately not the candidate cards: those add when pressed, which is the
      // opposite of what was asked.
      const outcome = seam(clerk).removeByName(['milk'], 1);

      expect(outcome.reason).toBe('ambiguous');
      expect(decreaseQuantity).not.toHaveBeenCalled();
      expect(removeFromCart).not.toHaveBeenCalled();
    });
  });

  describe('the single resolver', () => {
    it('answers a name nothing ranks as none', () => {
      expect(seam(clerk).resolveSpokenName(['pineapple'])).toEqual({ kind: 'none' });
    });

    it('answers a decisive name with the product', () => {
      const resolved = seam(clerk).resolveSpokenName(['sourdough']);
      expect(resolved.kind).toBe('one');
      expect(resolved.kind === 'one' && resolved.product.id).toBe('p3');
    });

    it('hands back the ambiguity set rather than a bare verdict', async () => {
      clerk.stop();
      getActiveProducts.mockResolvedValue([product('m1', 'Oat Milk'), product('m2', 'Soy Milk')]);
      await clerk.start();

      const resolved = seam(clerk).resolveSpokenName(['milk']);

      // The tied products, in ranked order, so a caller renders them as alternatives
      // without ranking the catalogue a second time.
      expect(resolved.kind).toBe('ambiguous');
      expect(resolved.kind === 'ambiguous' && resolved.products.map((entry) => entry.name)).toEqual(
        ['Oat Milk', 'Soy Milk']
      );
    });

    it('keeps the unknown-name behaviour byte for byte after the extraction', () => {
      publish.mockClear();
      tryAddToCart.mockClear();

      // A name nothing in the catalogue ranks at all. Not a near-miss like "oat
      // cream": 'oat' is a word unique to Oat Milk, so a near-miss resolves to it
      // and would exercise the add arm rather than this one.
      onFinalPhrase('add a pineapple');

      expect(clerk.caption()).toBe('I don\'t have "pineapple" in the catalogue.');
      expect(publish).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ reason: 'unknown-spoken-name' }),
        })
      );
      expect(tryAddToCart).not.toHaveBeenCalled();
    });

    it('resolves a name carrying one distinctive word rather than rejecting it', () => {
      tryAddToCart.mockClear();

      onFinalPhrase('add oat cream');

      // 'oat' belongs to exactly one product, so it identifies Oat Milk on its own
      // and the unsaid half of the name does not veto it. Pinned because it reads
      // like a miss and is not one: scoring is per distinctive word, not per whole
      // label, which is the same property that tells oat milk from soy milk.
      expect(clerk.caption()).toBe('One oat milk, added.');
      expect(tryAddToCart).toHaveBeenCalledTimes(1);
    });
  });

  describe('the checkout gate', () => {
    it('bumps the counter exactly once per request', () => {
      const before = clerk.checkoutRequested();

      clerk.requestCheckout();

      expect(clerk.checkoutRequested()).toBe(before + 1);
    });

    it('is the only thing a spoken checkout does', () => {
      const before = clerk.checkoutRequested();
      onFinalPhrase('checkout please');
      expect(clerk.checkoutRequested()).toBe(before + 1);
    });

    it('cannot be driven from outside the facade', () => {
      // A compile-time assertion, not a runtime one: the `@ts-expect-error` below
      // fails the build if `checkoutRequested` ever becomes writable again, which is
      // the property under test. Never invoked — `.set` does not exist at runtime
      // either, which is the point.
      const forbidden = (): void => {
        // @ts-expect-error checkoutRequested is a readonly Signal, by design
        clerk.checkoutRequested.set(99);
      };

      expect(forbidden).toBeTypeOf('function');
    });
  });
});

/**
 * Recognition is Chromium/Safari-only and needs a secure context, so "the browser
 * cannot listen" is a routine configuration, not an edge case. Its own module
 * setup, because the ear's support flag is read at construction.
 */
describe('ClerkFacade where the browser cannot listen', () => {
  let clerk: ClerkFacade;
  let earStart: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    earStart = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        ClerkFacade,
        {
          provide: VISION_RECOGNIZER,
          useValue: { identify: vi.fn().mockResolvedValue(nothing()), kind: 'demo' },
        },
        {
          provide: CameraService,
          useValue: {
            status: signal('live'),
            message: signal(''),
            start: vi.fn().mockResolvedValue(true),
            stop: vi.fn(),
            sampleFrame: vi.fn().mockReturnValue(null),
            captureFrame: vi.fn().mockReturnValue(null),
            detectionSource: vi.fn().mockReturnValue(null),
            cameras: signal([]),
            activeCameraId: signal<string | null>(null),
            hasChoice: signal(false),
            select: vi.fn().mockResolvedValue(true),
            activeCameraLabel: () => 'Camera',
          },
        },
        {
          provide: SpeechSynthesisService,
          useValue: {
            supported: false,
            speaking: signal(false),
            lastBoundaryAt: signal(0),
            muted: signal(false),
            setMuted: vi.fn(),
            speak: vi.fn(),
            cancel: vi.fn(),
          },
        },
        {
          provide: SpeechRecognitionService,
          useValue: {
            supported: false,
            interim: signal(''),
            onFinalPhrase: vi.fn(),
            start: earStart,
            stop: vi.fn(),
            pause: vi.fn(),
            resume: vi.fn(),
          },
        },
        {
          provide: PosFacade,
          useValue: {
            tryAddToCart: vi.fn().mockReturnValue({ added: true }),
            decreaseQuantity: vi.fn(),
            totalItems: signal(0),
            total: signal(0),
            isCartEmpty: signal(true),
          },
        },
        { provide: ProductService, useValue: { getActiveProducts: vi.fn().mockResolvedValue([]) } },
        { provide: EventBusService, useValue: { publish: vi.fn() } },
        { provide: TelemetryService, useValue: { recordCounter: vi.fn() } },
        {
          provide: BarcodeScannerService,
          useValue: {
            supported: signal(false),
            prepare: vi.fn().mockResolvedValue(false),
            detect: vi.fn().mockResolvedValue([]),
          },
        },
        {
          provide: RecognitionLogService,
          useValue: { record: vi.fn(), amend: vi.fn(), summarise: vi.fn(), clear: vi.fn() },
        },
      ],
    });
    clerk = TestBed.inject(ClerkFacade);
    await clerk.start();
  });

  afterEach(() => {
    clerk.stop();
  });

  it('reports that listening is unavailable', () => {
    expect(clerk.earSupported).toBe(false);
  });

  it('refuses to arm a microphone it does not have', () => {
    clerk.toggleMic();

    expect(clerk.micEnabled()).toBe(false);
    expect(earStart).not.toHaveBeenCalled();
  });

  it('still works by hand: it captions everything it would have said', () => {
    // The voice is an enhancement. With it gone the caption is the whole channel.
    clerk.speakTotal();
    expect(clerk.caption()).toBe('The cart is empty.');
  });
});
