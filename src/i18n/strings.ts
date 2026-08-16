/**
 * App strings in English (default) and Russian.
 *
 * Use `useI18n().t(key, vars)` in components instead of hardcoding UI text.
 * The default language is English; users can switch to Russian with the
 * language toggle (the choice is persisted on the device).
 */

export type Language = 'en' | 'ru';

const en = {
  'tab.home': 'Home',
  'tab.explore': 'Explore',
  'tab.batches': 'Batches',
  'tab.chat': 'Chat',

  'common.loading': 'Loading…',
  'common.retry': 'Retry',
  'common.ok': 'OK',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.saved': 'Saved',
  'common.canceled': 'Canceled',
  'common.failed': 'Error',
  'common.delete': 'Delete',

  'lang.tagline': 'Language',

  'models.title': 'Models (OpenRouter)',
  'models.refresh': 'refresh',
  'models.error': 'Could not load models from OpenRouter.',
  'models.loading': 'Loading models…',
  'models.batch.choiceHint': 'Batch models (OpenRouter)',
  'models.live.choiceHint': 'Models (OpenRouter)',
  'models.batch.customPlaceholder': '…or type your own batch model id',
  'models.live.customPlaceholder': '…or type your own model id',

  'home.heroTitle': 'Welcome to Expo',
  'home.getStarted': 'get started',
  'home.tryEditing': 'Try editing',
  'home.devTools': 'Dev tools',
  'home.freshStart': 'Fresh start',
  'home.rustUnavailable': 'MyRustModule is not available on web',
  'home.webDevtools': 'use browser devtools',
  'home.shakeDevice': 'shake device or press m in terminal',
  'home.pressShortcut': 'press {shortcut}',
  'home.deployHint': 'src/app/index.tsx',
  'home.resetHint': 'npm run reset-project',

  'explore.title': 'Explore',
  'explore.subtitle':
    'This starter app includes example code to help you get started.',

  'status.validating': 'validating',
  'status.in_progress': 'in progress',
  'status.finalizing': 'finalizing',
  'status.completed': 'completed',
  'status.failed': 'failed',
  'status.expired': 'expired',
  'status.cancelling': 'cancelling',
  'status.cancelled': 'cancelled',
  'status.pending': 'pending',
  'status.error': 'error',

  'card.title': 'OpenRouter: key & sessions',
  'card.batchModelNote':
    'Batch model: {model} — roughly 2× cheaper than the live model; runs up to ~24h.',
  'card.envKeyNote':
    'Key from the bundle (dev): {name} — visible to anyone who downloads the app.',
  'card.deviceKeyNote': 'Key on device: {masked} (Android Keystore).',
  'card.keyPlaceholder': 'Paste your API key…',
  'card.save': 'Save',
  'card.change': 'Change',
  'card.keySaved': 'Key saved in secure storage (Android Keystore).',
  'card.keySavedFail': 'Could not save the key in secure storage.',
  'card.keyDelete': 'Delete key',
  'card.keyDeleted': 'Stored device key removed.',
  'card.secureUnavailable':
    'Secure storage only works on a device (not the web).',
  'card.runTest': 'Run test batch',
  'card.creating': 'Creating batch…',
  'card.batchCreated': 'Batch {id} created ({status}). Waiting…',
  'card.batchPolling': 'Batch {id}: {status} ({completed}/{total} done)',
  'card.batchDone':
    'Batch finished: {status}. Total requests: {total}, errors: {failed}.',
  'card.batchError': 'Batch failed',
  'card.errorPrefix': 'Error: {message}',

  'batches.title': 'Batches',
  'batches.subtitle':
    'One line = one request. Send them as a batch and come back: the answers (and the math) will be collected right here.',
  'batches.promptPlaceholder': 'Question 1\nQuestion 2\nQuestion 3…',
  'batches.jobCount': '{count} / {max} requests',
  'batches.send': 'Send batch',
  'batches.sending': 'Sending…',
  'batches.emptyTitle': 'Nothing to send',
  'batches.emptyBody':
    'Enter at least one question — each line is a separate request.',
  'batches.modelTitle': 'Model',
  'batches.modelBody': 'Specify a model.',
  'batches.createError': 'Could not create batch',
  'batches.historyEmpty': 'History is empty — send your first batch.',
  'batches.doneCount': '{completed}/{total} done',
  'batches.errorsCount': ' · {failed} errors',
  'batches.noAnswer': 'no answer',
  'batches.copyAll': 'Copy all',
  'batches.exportJson': 'JSON',
  'batches.saveCsv': 'Save .csv',
  'batches.delete': 'Delete',
  'batches.copyLabel': 'Copied',
  'batches.copyBody': '{label} copied to the clipboard.',
  'batches.copyFail': 'Copy failed',
  'batches.copyPromptLabel': 'Prompt',
  'batches.copyAnswersLabel': 'Answers',
  'batches.fileFail': 'Could not save/share the file',
  'batches.saved': 'Saved in Downloads.',
  'batches.shared': 'File shared.',

  'chat.title': 'Chat',
  'chat.subtitle':
    'Ask one thing at a time — the model answers immediately. Formulas come back in LaTeX.',
  'chat.placeholder': 'Type a message…',
  'chat.send': 'Send',
  'chat.clear': 'Clear',
  'chat.clearConfirm': 'Clear the conversation?',
  'chat.thinking': '{model} is thinking…',
  'chat.empty':
    'Say something! Ask a question, or paste a formula you want solved.',
  'chat.errorMessage': 'Error: {message}',
};

export type TKey = keyof typeof en;
const ru: Record<TKey, string> = {
  'tab.home': 'Главная',
  'tab.explore': 'Обзор',
  'tab.batches': 'Батчи',
  'tab.chat': 'Чат',

  'common.loading': 'Загрузка…',
  'common.retry': 'Повторить',
  'common.ok': 'ОК',
  'common.cancel': 'Отмена',
  'common.close': 'Закрыть',
  'common.saved': 'Сохранено',
  'common.canceled': 'Отменено',
  'common.failed': 'Ошибка',
  'common.delete': 'Удалить',

  'lang.tagline': 'Язык',

  'models.title': 'Модели (OpenRouter)',
  'models.refresh': 'обновить',
  'models.error': 'Не удалось загрузить модели из OpenRouter.',
  'models.loading': 'Загружаю модели…',
  'models.batch.choiceHint': 'Батч-модели (OpenRouter)',
  'models.live.choiceHint': 'Модели (OpenRouter)',
  'models.batch.customPlaceholder': '…или впиши свой id батч-модели',
  'models.live.customPlaceholder': '…или впиши свой id модели',

  'home.heroTitle': 'Добро пожаловать в Expo',
  'home.getStarted': 'начни здесь',
  'home.tryEditing': 'Попробуй отредактировать',
  'home.devTools': 'Инструменты разработчика',
  'home.freshStart': 'Заново с чистого листа',
  'home.rustUnavailable': 'MyRustModule недоступен в вебе',
  'home.webDevtools': 'используй devtools браузера',
  'home.shakeDevice': 'потряси телефон или нажми m в терминале',
  'home.pressShortcut': 'нажми {shortcut}',
  'home.deployHint': 'src/app/index.tsx',
  'home.resetHint': 'npm run reset-project',

  'explore.title': 'Обзор',
  'explore.subtitle':
    'В стартовом приложении есть примеры кода, чтобы помочь тебе начать.',

  'status.validating': 'проверка',
  'status.in_progress': 'в работе',
  'status.finalizing': 'завершение',
  'status.completed': 'готово',
  'status.failed': 'ошибка',
  'status.expired': 'истёк',
  'status.cancelling': 'отмена…',
  'status.cancelled': 'отменён',
  'status.pending': 'ожидание',
  'status.error': 'ошибка',

  'card.title': 'OpenRouter: ключ и сессии',
  'card.batchModelNote':
    'Батч-модель: {model} — примерно в 2 раза дешевле обычной; живёт до ~24 ч.',
  'card.envKeyNote':
    'Ключ из бандла (dev): {name} — виден всем, кто скачает приложение.',
  'card.deviceKeyNote': 'Ключ на устройстве: {masked} (Android Keystore).',
  'card.keyPlaceholder': 'Вставь свой API-ключ…',
  'card.save': 'Сохранить',
  'card.change': 'Изменить',
  'card.keySaved': 'Ключ сохранён в защищённом хранилище (Android Keystore).',
  'card.keySavedFail': 'Не удалось сохранить ключ в защищённом хранилище.',
  'card.keyDelete': 'Удалить ключ',
  'card.keyDeleted': 'Сохранённый на устройстве ключ удалён.',
  'card.secureUnavailable':
    'Защищённое хранилище работает только на устройстве (не в вебе).',
  'card.runTest': 'Запустить тест-батч',
  'card.creating': 'Создаю батч…',
  'card.batchCreated': 'Батч {id} создан ({status}). Жду выполнения…',
  'card.batchPolling': 'Батч {id}: {status} ({completed}/{total} готово)',
  'card.batchDone':
    'Батч завершён: {status}. Всего запросов: {total}, ошибок: {failed}.',
  'card.batchError': 'Ошибка батча',
  'card.errorPrefix': 'Ошибка: {message}',

  'batches.title': 'Батчи',
  'batches.subtitle':
    'Одна строка = один запрос. Отправляй пачкой и возвращайся: ответы (и формулы) соберутся прямо здесь.',
  'batches.promptPlaceholder': 'Вопрос №1\nВопрос №2\nВопрос №3…',
  'batches.jobCount': '{count} / {max} запросов',
  'batches.send': 'Отправить батч',
  'batches.sending': 'Отправляю…',
  'batches.emptyTitle': 'Пусто',
  'batches.emptyBody':
    'Введи хотя бы один вопрос — каждая строка = отдельный запрос.',
  'batches.modelTitle': 'Модель',
  'batches.modelBody': 'Укажи модель.',
  'batches.createError': 'Не удалось создать батч',
  'batches.historyEmpty': 'История пуста — отправь первый батч.',
  'batches.doneCount': '{completed}/{total} готово',
  'batches.errorsCount': ' · {failed} ошибок',
  'batches.noAnswer': 'без ответа',
  'batches.copyAll': 'Копировать всё',
  'batches.exportJson': 'JSON',
  'batches.saveCsv': 'Сохранить .csv',
  'batches.delete': 'Удалить',
  'batches.copyLabel': 'Скопировано',
  'batches.copyBody': '{label} — в буфере обмена.',
  'batches.copyFail': 'Не удалось скопировать',
  'batches.copyPromptLabel': 'Вопрос',
  'batches.copyAnswersLabel': 'Ответы',
  'batches.fileFail': 'Не удалось сохранить/поделиться файлом',
  'batches.saved': 'Файл сохранён в Downloads.',
  'batches.shared': 'Файл отправлен.',

  'chat.title': 'Чат',
  'chat.subtitle':
    'Спрашивай по одному — модель отвечает сразу. Формулы возвращаются в LaTeX.',
  'chat.placeholder': 'Напиши сообщение…',
  'chat.send': 'Отправить',
  'chat.clear': 'Очистить',
  'chat.clearConfirm': 'Очистить переписку?',
  'chat.thinking': '{model} думает…',
  'chat.empty':
    'Напиши что-нибудь! Спроси что угодно или приведи формулу, которую нужно решить.',
  'chat.errorMessage': 'Ошибка: {message}',
};

export const translations: Record<Language, Record<TKey, string>> = { en, ru };