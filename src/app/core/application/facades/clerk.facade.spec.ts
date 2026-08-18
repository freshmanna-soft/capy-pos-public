import { TestBed } from '@angular/core/testing';
import { WritableSignal, computed, signal } from '@angular/core';
import { AUTO_ADD_CONFIDENCE, ClerkFacade, UNDO_WINDOW_MS } from './clerk.facade';
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

function nothing(): RecognitionResult {
  return { candidates: [], utterance: "I can't tell what that is.", empty: true };
}

describe('ClerkFacade', () => {
  let clerk: ClerkFacade;
  let identify: ReturnType<typeof vi.fn>;
  let cameraStart: ReturnType<typeof vi.fn>;
  let captureFrame: ReturnType<typeof vi.fn>;
  let speak: ReturnType<typeof vi.fn>;
  let cancelSpeech: ReturnType<typeof vi.fn>;
  let speaking: WritableSignal<boolean>;
  let earPause: ReturnType<typeof vi.fn>;
  let earResume: ReturnType<typeof vi.fn>;
  let earStart: ReturnType<typeof vi.fn>;
  let earStop: ReturnType<typeof vi.fn>;
  let onFinalPhrase: (phrase: string) => void;
  let tryAddToCart: ReturnType<typeof vi.fn>;
  let decreaseQuantity: ReturnType<typeof vi.fn>;
  let publish: ReturnType<typeof vi.fn>;
  let getActiveProducts: ReturnType<typeof vi.fn>;
  let sampleFrame: ReturnType<typeof vi.fn>;
  let cameras: WritableSignal<{ deviceId: string; label: string }[]>;
  let activeCameraId: WritableSignal<string | null>;
  let selectCamera: ReturnType<typeof vi.fn>;
  let detectionSource: ReturnType<typeof vi.fn>;
  let detectCodes: ReturnType<typeof vi.fn>;
  let prepareScanner: ReturnType<typeof vi.fn>;
  let logRecord: ReturnType<typeof vi.fn>;
  let logAmend: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    identify = vi.fn().mockResolvedValue(confident());
    cameraStart = vi.fn().mockResolvedValue(true);
    captureFrame = vi.fn().mockReturnValue({ base64: 'ZmFrZQ==', width: 768, height: 576 });
    speak = vi.fn();
    cancelSpeech = vi.fn();
    speaking = signal(false);
    earPause = vi.fn();
    earResume = vi.fn();
    earStart = vi.fn();
    earStop = vi.fn();
    tryAddToCart = vi.fn().mockReturnValue({ added: true });
    decreaseQuantity = vi.fn();
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
            totalItems: signal(2),
            total: signal(7.5),
            isCartEmpty: signal(false),
          },
        },
        { provide: ProductService, useValue: { getActiveProducts } },
        { provide: EventBusService, useValue: { publish } },
        { provide: TelemetryService, useValue: { recordCounter: vi.fn() } },
        {
          provide: BarcodeScannerService,
          useValue: { supported: signal(true), prepare: prepareScanner, detect: detectCodes },
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

      expect(clerk.pendingAdd()).toEqual({ productId: 'p1', label: 'Avocado' });
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
    /** One code filling a good part of the frame — a deliberate presentation. */
    function seen(value: string, width = 0.3): ScannedCode {
      return { value, format: 'ean_13', box: { x: 0.2, y: 0.3, width, height: 0.2 } };
    }

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
      expect(clerk.pendingAdd()).toEqual({ productId: 'p1', label: 'Avocado' });
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
