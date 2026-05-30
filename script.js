/**
 * ScheduleLLM - Core Logic
 */

// Global State
let workbook = null;
let rawScheduleData = [];
let defaultTimeSlots = [
    { start: '08:20', end: '09:05' }, // 1
    { start: '09:15', end: '10:00' }, // 2
    { start: '10:20', end: '11:05' }, // 3
    { start: '11:15', end: '12:00' }, // 4
    { start: '14:30', end: '15:15' }, // 5
    { start: '15:25', end: '16:10' }, // 6
    { start: '16:30', end: '17:15' }, // 7
    { start: '17:15', end: '18:00' }, // 8
    { start: '19:10', end: '19:55' }, // 9
    { start: '19:55', end: '20:40' }  // 10
];

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initTimeSettings();
    initTimeSettingsCollapsible();

    // Load Configuration from config.js if available
    if (window.AppConfig) {
        const baseUrlInput = document.getElementById('llmBaseUrl');
        const modelInput = document.getElementById('llmModel');

        const llmApiUrl = window.AppConfig.llmApiUrl || window.AppConfig.backendUrl;
        if (llmApiUrl) baseUrlInput.value = llmApiUrl;
        if (window.AppConfig.model) modelInput.value = window.AppConfig.model;

        console.log("Environment configuration loaded.");
    }

    const fileUploadInput = document.getElementById('fileUpload');
    if (fileUploadInput) fileUploadInput.addEventListener('change', handleFileUpload);

    const btnReupload = document.getElementById('btnReupload');
    if (btnReupload && fileUploadInput) {
        btnReupload.addEventListener('click', () => {
            fileUploadInput.value = '';
            fileUploadInput.click();
        });
    }

    document.getElementById('btnGenerate').addEventListener('click', generateSchedule);

    const retryA = document.getElementById('llmProgressRetry');
    const retryB = document.getElementById('llmProgressErrorRetry');
    if (retryA) retryA.addEventListener('click', () => generateSchedule());
    if (retryB) retryB.addEventListener('click', () => generateSchedule());

    const list = document.getElementById('llmRecognizedList');
    if (list) {
        list.addEventListener('click', (e) => {
            const btn = e.target && e.target.closest ? e.target.closest('button[data-idx]') : null;
            if (!btn) return;
            const idx = parseInt(btn.getAttribute('data-idx'), 10);
            if (!Number.isFinite(idx)) return;
            scheduleLLMProgressShowDetail(idx);
        });
    }

    const courseListPanel = document.getElementById('courseListPanel');
    const courseListToggle = document.getElementById('courseListToggle');
    if (courseListPanel && courseListToggle) {
        courseListPanel.classList.toggle('is-open', false);
        courseListToggle.setAttribute('aria-expanded', 'false');
        courseListToggle.addEventListener('click', () => {
            const open = !courseListPanel.classList.contains('is-open');
            courseListPanel.classList.toggle('is-open', open);
            courseListToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        });
    }

    if (typeof scheduleLLMSetCourseListVisible === 'function') {
        scheduleLLMSetCourseListVisible(false);
    } else if (courseListPanel) {
        courseListPanel.style.display = 'none';
    }

    // LLM Toggle listener
    const useLLMCheckbox = document.getElementById('useLLM');
    const llmConfigFields = document.getElementById('llmConfigFields');
    
    // 状态标记：记录是否经历过“取消勾选”的操作
    // 如果用户手动取消过勾选，再次勾选时不再自动弹出配置面板
    let hasLLMBeenUnchecked = false;

    useLLMCheckbox.addEventListener('change', () => {
        if (!useLLMCheckbox.checked) {
            // 用户取消勾选 -> 隐藏配置面板，并标记状态
            llmConfigFields.style.display = 'none';
            hasLLMBeenUnchecked = true;
        } else {
            // 用户勾选 -> 仅当从未取消过（即首次勾选或初始状态）时才显示
            // 如果已经取消过一次，再次勾选时保持隐藏（避免打扰用户）
            if (!hasLLMBeenUnchecked) {
                llmConfigFields.style.display = 'block';
            } else {
                llmConfigFields.style.display = 'none';
            }
        }
    });
});

function initTimeSettings() {
    const legacy = document.getElementById('timeSettings');
    const always = document.getElementById('timeSettingsAlways');
    const extra = document.getElementById('timeSettingsExtra');

    const clear = (el) => {
        if (!el) return;
        while (el.firstChild) el.removeChild(el.firstChild);
    };

    if (always || extra) {
        clear(always);
        clear(extra);
    } else {
        clear(legacy);
    }

    const addRow = (container, slot, index) => {
        if (!container) return;
        const row = document.createElement('div');
        row.style.display = 'contents';
        row.innerHTML = `
            <span>${index + 1}</span>
            <input type="time" value="${slot.start}" data-idx="${index}" data-type="start">
            <input type="time" value="${slot.end}" data-idx="${index}" data-type="end">
        `;
        container.appendChild(row);
    };

    defaultTimeSlots.forEach((slot, index) => {
        if (always || extra) {
            if (index === 0) addRow(always, slot, index);
            else addRow(extra, slot, index);
            return;
        }
        addRow(legacy, slot, index);
    });

    scheduleLLMUpdateTimeSettingsSummary();
    const start = document.querySelector('input[type="time"][data-idx="0"][data-type="start"]');
    const end = document.querySelector('input[type="time"][data-idx="0"][data-type="end"]');
    if (start) start.addEventListener('input', scheduleLLMUpdateTimeSettingsSummary);
    if (end) end.addEventListener('input', scheduleLLMUpdateTimeSettingsSummary);
    scheduleLLMInitTimeInputHandlers();
}

function scheduleLLMUpdateTimeSettingsSummary() {
    const start = document.querySelector('input[type="time"][data-idx="0"][data-type="start"]');
    const end = document.querySelector('input[type="time"][data-idx="0"][data-type="end"]');
    const el = document.getElementById('timeSettingsSummary');
    if (!el) return;
    const s = start && start.value ? start.value : '';
    const e = end && end.value ? end.value : '';
    const mid = (s || e) ? (s + (s && e ? '-' : '') + e) : '';
    el.textContent = '第1节' + (mid ? ' ' + mid : '');
}

function scheduleLLMGetTimeInput(idx, type) {
    return document.querySelector(`input[type="time"][data-idx="${idx}"][data-type="${type}"]`);
}

function scheduleLLMGetTimeSlotsFromInputs() {
    const slots = [];
    for (let i = 0; i < defaultTimeSlots.length; i++) {
        const startInput = scheduleLLMGetTimeInput(i, 'start');
        const endInput = scheduleLLMGetTimeInput(i, 'end');
        const fallback = defaultTimeSlots[i] || { start: '', end: '' };
        const start = startInput && startInput.value ? startInput.value : fallback.start;
        const end = endInput && endInput.value ? endInput.value : fallback.end;
        slots.push({ start, end });
    }
    return slots;
}

function scheduleLLMGetBaseSlotsForChange(idx, type, prevValue) {
    const slots = scheduleLLMGetTimeSlotsFromInputs();
    if (slots[idx]) {
        if (type === 'start') slots[idx].start = prevValue;
        if (type === 'end') slots[idx].end = prevValue;
    }
    return slots;
}

function scheduleLLMApplyTimeSlotsToInputs(slots, indices) {
    indices.forEach(idx => {
        const entry = slots[idx];
        if (!entry) return;
        const startInput = scheduleLLMGetTimeInput(idx, 'start');
        const endInput = scheduleLLMGetTimeInput(idx, 'end');
        if (startInput) startInput.value = entry.start;
        if (endInput) endInput.value = entry.end;
    });
}

function scheduleLLMUpdateTimeInputsPrev(indices) {
    indices.forEach(idx => {
        const startInput = scheduleLLMGetTimeInput(idx, 'start');
        const endInput = scheduleLLMGetTimeInput(idx, 'end');
        if (startInput) startInput.dataset.prev = startInput.value || '';
        if (endInput) endInput.dataset.prev = endInput.value || '';
    });
}

function scheduleLLMShowTimeSettingsError(message) {
    alert(message);
}

function scheduleLLMIsCompleteTimeValue(value) {
    return /^\d{2}:\d{2}$/.test(String(value || ''));
}

function scheduleLLMHandleTimeInputChange(e, opts = {}) {
    const input = e && e.target ? e.target : null;
    if (!input || input.type !== 'time') return;
    const idx = Number(input.dataset.idx);
    const type = input.dataset.type;
    if (!Number.isFinite(idx) || (type !== 'start' && type !== 'end')) return;

    const timeUtils = window.ScheduleLLMTimeUtils;
    const nextValue = input.value || '';
    const prevValue = input.dataset.prev || nextValue;
    const force = !!opts.force;

    if (!timeUtils || typeof timeUtils.isValidTime !== 'function' || typeof timeUtils.computeShiftedSlots !== 'function') {
        input.dataset.prev = nextValue;
        scheduleLLMUpdateTimeSettingsSummary();
        return;
    }

    const isComplete = scheduleLLMIsCompleteTimeValue(nextValue);
    if (!isComplete) {
        if (force && nextValue) {
            input.value = prevValue;
            scheduleLLMUpdateTimeSettingsSummary();
            scheduleLLMShowTimeSettingsError('时间格式不正确');
        }
        return;
    }

    if (!timeUtils.isValidTime(nextValue)) {
        input.value = prevValue;
        scheduleLLMUpdateTimeSettingsSummary();
        scheduleLLMShowTimeSettingsError('时间格式不正确');
        return;
    }

    const baseSlots = scheduleLLMGetBaseSlotsForChange(idx, type, prevValue);
    let maxIndex = idx;
    if (idx === 0) maxIndex = 3;
    if (idx === 4) maxIndex = 7;
    if (idx === 8) maxIndex = 9;
    const result = timeUtils.computeShiftedSlots(baseSlots, idx, type, nextValue, { firstDuration: 45, maxIndex });
    if (!result.ok) {
        input.value = prevValue;
        scheduleLLMUpdateTimeSettingsSummary();
        scheduleLLMShowTimeSettingsError(result.message || '时间调整失败');
        return;
    }

    const slots = result.slots;
    const impacted = [];
    for (let i = idx; i < slots.length && i <= maxIndex; i++) impacted.push(i);
    scheduleLLMApplyTimeSlotsToInputs(slots, impacted);
    scheduleLLMUpdateTimeInputsPrev(impacted);
    scheduleLLMUpdateTimeSettingsSummary();
}

function scheduleLLMInitTimeInputHandlers() {
    const inputs = document.querySelectorAll('input[type="time"][data-idx][data-type]');
    const debounceMs = 2000;
    const timers = new WeakMap();
    inputs.forEach(input => {
        input.dataset.prev = input.value || '';
        input.addEventListener('input', (e) => {
            const prevTimer = timers.get(input);
            if (prevTimer) clearTimeout(prevTimer);
            const timer = setTimeout(() => {
                scheduleLLMHandleTimeInputChange(e, { force: false });
            }, debounceMs);
            timers.set(input, timer);
        });
        input.addEventListener('blur', (e) => {
            const prevTimer = timers.get(input);
            if (prevTimer) clearTimeout(prevTimer);
            scheduleLLMHandleTimeInputChange(e, { force: true });
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const prevTimer = timers.get(input);
                if (prevTimer) clearTimeout(prevTimer);
                scheduleLLMHandleTimeInputChange(e, { force: true });
            }
        });
    });
}

function initTimeSettingsCollapsible() {
    const panel = document.getElementById('timeSettingsPanel');
    if (!panel) return;

    const header = document.getElementById('timeSettingsHeader');
    const icon = document.getElementById('timeSettingsToggleIcon');
    const hint = document.getElementById('timeSettingsHint');
    const extraWrap = document.getElementById('timeSettingsExtraWrap');

    const setExpanded = (expanded) => {
        panel.classList.toggle('expanded', expanded);
        if (header) header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        if (extraWrap) extraWrap.setAttribute('aria-hidden', expanded ? 'false' : 'true');
        if (icon) icon.textContent = expanded ? '∧' : '∨';
        if (hint) hint.textContent = expanded ? '点击收起' : '点击展开查看完整课表时间';
    };

    const toggle = () => {
        const expanded = panel.classList.contains('expanded');
        setExpanded(!expanded);
    };

    setExpanded(false);

    const onPanelClick = (e) => {
        const t = e && e.target;
        if (t && t.closest && t.closest('input, select, textarea, button, a, label')) return;
        toggle();
    };

    panel.addEventListener('click', onPanelClick);

    if (header) {
        header.addEventListener('keydown', (e) => {
            const k = e && e.key;
            if (k === 'Enter' || k === ' ') {
                e.preventDefault();
                toggle();
            }
        });
    }
}

// File Handling
function scheduleLLMMakeNonce() {
    if (typeof crypto !== 'undefined' && crypto && crypto.randomUUID) return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && crypto && crypto.getRandomValues) {
        const b = new Uint8Array(16);
        crypto.getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const hex = Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function scheduleLLMUploadEls() {
    return {
        fileName: document.getElementById('fileName'),
        host: document.getElementById('uploadPreview'),
        body: document.getElementById('uploadPreviewBody'),
        progress: document.getElementById('uploadProgressText')
    };
}

function scheduleLLMSetUploadPreviewVisible(visible) {
    const els = scheduleLLMUploadEls();
    if (!els.host) return;
    els.host.style.display = visible ? 'block' : 'none';
}

function scheduleLLMUploadDotsState() {
    if (!window.__scheduleLLMUploadDots) {
        window.__scheduleLLMUploadDots = { timer: null, base: '', n: 0 };
    }
    return window.__scheduleLLMUploadDots;
}

function scheduleLLMUploadDotsStop() {
    const st = scheduleLLMUploadDotsState();
    if (st.timer) {
        clearInterval(st.timer);
        st.timer = null;
    }
    st.base = '';
    st.n = 0;
}

function scheduleLLMUploadDotsStart(baseText) {
    const st = scheduleLLMUploadDotsState();
    st.base = String(baseText || '').trim();
    st.n = 0;
    if (st.timer) return;
    st.timer = setInterval(() => {
        const els = scheduleLLMUploadEls();
        if (!els.progress) return;
        const cur = scheduleLLMUploadDotsState();
        cur.n = (cur.n % 3) + 1;
        els.progress.textContent = `${cur.base}${'.'.repeat(cur.n)}`;
    }, 450);
}

function scheduleLLMSetUploadProgress(text, visible = true) {
    const els = scheduleLLMUploadEls();
    if (!els.progress) return;

    const t = String(text || '');
    const isLoadingPdf = /正在加载\s*PDF\s*解析组件/.test(t);

    if (!visible || !isLoadingPdf) {
        scheduleLLMUploadDotsStop();
        els.progress.textContent = t;
        els.progress.style.display = visible ? 'block' : 'none';
        return;
    }

    const base = t.replace(/[.。…]+\s*$/g, '').trim();
    els.progress.style.display = 'block';
    scheduleLLMUploadDotsStart(base);
}

function scheduleLLMFormatBytes(n) {
    const x = Number(n);
    if (!Number.isFinite(x) || x <= 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let v = x;
    while (v >= 1024 && i < u.length - 1) {
        v /= 1024;
        i++;
    }
    const digits = i === 0 ? 0 : (i === 1 ? 1 : 2);
    return `${v.toFixed(digits)} ${u[i]}`;
}

function scheduleLLMFormatSpeed(bps) {
    const x = Number(bps);
    if (!Number.isFinite(x) || x <= 0) return '--';
    return `${scheduleLLMFormatBytes(x)}/s`;
}

function scheduleLLMFormatEta(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    if (!Number.isFinite(s) || s <= 0) return '--';
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m${String(r).padStart(2, '0')}s`;
}

function scheduleLLMCalendarProgressMarkupHtml() {
    return `
        <div class="schedulellm-calendar-progress" data-role="host">
            <div class="schedulellm-calendar-progress-title" data-role="title">
                <span data-role="titleText"></span>
                <span class="schedulellm-ellipsis" data-role="titleDots" aria-hidden="true"></span>
                <span class="schedulellm-busy-icon" data-role="busyIcon" aria-hidden="true"></span>
            </div>
            <div class="schedulellm-calendar-progress-bar" data-role="bar">
                <div class="schedulellm-calendar-progress-fill" data-role="fill"></div>
            </div>
            <div class="schedulellm-calendar-progress-meta" data-role="meta">
                <div data-role="speed"></div>
                <div data-role="eta"></div>
            </div>
            <div class="schedulellm-calendar-progress-extra" data-role="extra"></div>
        </div>
    `;
}

function scheduleLLMCalendarProgressEls() {
    const calendarArea = document.getElementById('calendarArea');
    if (!calendarArea) return null;

    const hasCalendarScaffold = !!(calendarArea.querySelector('.calendar-month-viewport') || calendarArea.querySelector('.calendar-nav'));
    const placeholder = calendarArea.querySelector('.placeholder-text');
    const usePlaceholder = !!placeholder && !hasCalendarScaffold;

    let root = null;
    if (usePlaceholder) {
        root = placeholder;
        root.classList.remove('placeholder-uploaded');
        root.classList.add('status-updated');
    } else {
        let statusHost = calendarArea.querySelector('.schedulellm-calendar-status');
        if (!statusHost) {
            statusHost = document.createElement('div');
            statusHost.className = 'schedulellm-calendar-status no-print';
            calendarArea.prepend(statusHost);
        }
        statusHost.style.display = '';
        root = statusHost;
    }

    let host = root.querySelector('.schedulellm-calendar-progress');
    if (!host) {
        root.innerHTML = scheduleLLMCalendarProgressMarkupHtml();
        host = root.querySelector('.schedulellm-calendar-progress');
    }

    const q = (sel) => root.querySelector(sel);
    return {
        calendarArea,
        root,
        host,
        usePlaceholder,
        title: q('[data-role="title"]'),
        titleText: q('[data-role="titleText"]'),
        titleDots: q('[data-role="titleDots"]'),
        busyIcon: q('[data-role="busyIcon"]'),
        bar: q('[data-role="bar"]'),
        fill: q('[data-role="fill"]'),
        meta: q('[data-role="meta"]'),
        speed: q('[data-role="speed"]'),
        eta: q('[data-role="eta"]'),
        extra: q('[data-role="extra"]')
    };
}

function scheduleLLMHideCalendarProgress(delayMs = 0) {
    const ms = Math.max(0, parseInt(delayMs || 0, 10) || 0);
    const calendarArea = document.getElementById('calendarArea');
    if (!calendarArea) return;

    const hideNow = () => {
        const statusHost = calendarArea.querySelector('.schedulellm-calendar-status');
        if (statusHost) statusHost.style.display = 'none';
    };

    if (!ms) {
        hideNow();
        return;
    }

    setTimeout(hideNow, ms);
}

function scheduleLLMCalendarFakeProgressState() {
    if (!window.__scheduleLLMCalendarFakeProgress) {
        window.__scheduleLLMCalendarFakeProgress = { timer: null, pct: 0, active: false };
    }
    return window.__scheduleLLMCalendarFakeProgress;
}

function scheduleLLMCalendarDotsState() {
    if (!window.__scheduleLLMCalendarDots) {
        window.__scheduleLLMCalendarDots = { timer: null, n: 0, base: '', el: null };
    }
    return window.__scheduleLLMCalendarDots;
}

function scheduleLLMCalendarDotsStop() {
    const st = scheduleLLMCalendarDotsState();
    if (st.timer) {
        clearInterval(st.timer);
        st.timer = null;
    }
    st.n = 0;
    st.base = '';
    if (st.el) st.el.textContent = '';
    st.el = null;
}

function scheduleLLMCalendarDotsStart(baseText, dotsEl) {
    const st = scheduleLLMCalendarDotsState();
    st.base = String(baseText || '').trim();
    st.el = dotsEl || null;
    if (!st.el) return;

    st.n = 0;
    if (st.timer) return;
    st.timer = setInterval(() => {
        const cur = scheduleLLMCalendarDotsState();
        if (!cur.el) return;
        cur.n = (cur.n % 3) + 1;
        cur.el.textContent = '.'.repeat(cur.n);
    }, 450);
}

function scheduleLLMCalendarFakeProgressStop() {
    const st = scheduleLLMCalendarFakeProgressState();
    st.active = false;
    if (st.timer) {
        clearInterval(st.timer);
        st.timer = null;
    }
}

function scheduleLLMCalendarFakeProgressApply(pct) {
    const els = scheduleLLMCalendarProgressEls();
    if (!els || !els.bar || !els.fill) return;
    const clamped = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
    els.bar.style.display = 'block';
    els.bar.setAttribute('role', 'progressbar');
    els.bar.setAttribute('aria-label', '处理进度');
    els.bar.setAttribute('aria-valuemin', '0');
    els.bar.setAttribute('aria-valuemax', '100');
    els.bar.setAttribute('aria-valuenow', String(clamped));
    els.fill.style.width = `${clamped}%`;
}

function scheduleLLMCalendarFakeProgressStart(startPct = 0) {
    const st = scheduleLLMCalendarFakeProgressState();
    const start = Math.max(0, Math.min(80, Math.round(Number(startPct) || 0)));
    st.pct = start;
    st.active = true;
    scheduleLLMCalendarFakeProgressApply(st.pct);

    if (st.timer) {
        clearInterval(st.timer);
        st.timer = null;
    }

    st.timer = setInterval(() => {
        const cur = scheduleLLMCalendarFakeProgressState();
        if (!cur.active) return;
        if (cur.pct >= 80) {
            cur.pct = 80;
            scheduleLLMCalendarFakeProgressApply(cur.pct);
            scheduleLLMCalendarFakeProgressStop();
            return;
        }
        cur.pct = Math.min(80, cur.pct + 10);
        scheduleLLMCalendarFakeProgressApply(cur.pct);
    }, 3000);
}

function scheduleLLMSetCalendarProgress(title, percent, speedBps, etaSec, extra, state) {
    const els = scheduleLLMCalendarProgressEls();
    if (!els) return;

    const busy = state !== 'ok' && state !== 'err';

    if (els.host) {
        els.host.classList.toggle('schedulellm-calendar-progress--error', state === 'err');
        els.host.classList.toggle('schedulellm-calendar-progress--busy', !!busy);
        els.host.setAttribute('role', 'status');
        els.host.setAttribute('aria-live', 'polite');
        els.host.setAttribute('aria-atomic', 'true');
        els.host.setAttribute('aria-busy', busy ? 'true' : 'false');
    }

    const rawTitle = String(title || '').trim();
    const isLoadingPdf = /正在加载\s*PDF\s*解析组件/.test(rawTitle);

    if (els.titleText) els.titleText.textContent = isLoadingPdf ? rawTitle.replace(/[.。…]+\s*$/g, '').trim() : rawTitle;

    if (els.titleDots) {
        if (busy && isLoadingPdf) {
            scheduleLLMCalendarDotsStart(rawTitle, els.titleDots);
        } else {
            scheduleLLMCalendarDotsStop();
        }
    }

    const hasPct = percent !== null && percent !== undefined && percent !== '' && Number.isFinite(Number(percent));
    const pct = hasPct ? Number(percent) : NaN;

    if (els.bar) {
        els.bar.style.display = 'block';
        els.bar.setAttribute('role', 'progressbar');
        els.bar.setAttribute('aria-label', '处理进度');
        els.bar.setAttribute('aria-valuemin', '0');
        els.bar.setAttribute('aria-valuemax', '100');
    }

    if (hasPct) {
        scheduleLLMCalendarFakeProgressStop();
        const clamped = Math.max(0, Math.min(100, Math.round(pct)));
        if (els.fill) els.fill.style.width = `${clamped}%`;
        if (els.bar) els.bar.setAttribute('aria-valuenow', String(clamped));
    } else {
        const st = scheduleLLMCalendarFakeProgressState();
        if (busy && !st.active) {
            scheduleLLMCalendarFakeProgressStart(st.pct || 0);
        } else {
            scheduleLLMCalendarFakeProgressApply(st.pct || 0);
        }
    }

    const s = scheduleLLMFormatSpeed(speedBps);
    const e = scheduleLLMFormatEta(etaSec);
    const showMeta = (s && s !== '--') || (e && e !== '--');
    if (els.meta) els.meta.style.display = showMeta ? 'flex' : 'none';
    if (els.speed) els.speed.textContent = s && s !== '--' ? `上传速度：${s}` : '';
    if (els.eta) els.eta.textContent = e && e !== '--' ? `剩余时间：${e}` : '';

    if (els.extra) {
        const t = String(extra || '');
        els.extra.textContent = t;
        els.extra.style.display = t ? 'block' : 'none';
    }
}

function scheduleLLMClearUploadPreviewBody() {
    const els = scheduleLLMUploadEls();
    if (!els.body) return;
    while (els.body.firstChild) els.body.removeChild(els.body.firstChild);
}

function scheduleLLMShowUploadPreviewImage(dataUrl) {
    const els = scheduleLLMUploadEls();
    if (!els.body) return;
    scheduleLLMClearUploadPreviewBody();
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = '课表预览';
    img.style.maxWidth = '100%';
    img.style.borderRadius = '8px';
    img.style.border = '1px solid #eee';
    els.body.appendChild(img);
}

function scheduleLLMShowUploadPreviewCanvas(canvas) {
    const els = scheduleLLMUploadEls();
    if (!els.body) return;
    scheduleLLMClearUploadPreviewBody();
    canvas.style.maxWidth = '100%';
    canvas.style.borderRadius = '8px';
    canvas.style.border = '1px solid #eee';
    els.body.appendChild(canvas);
}

function scheduleLLMReadAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = (e) => resolve(e && e.target ? e.target.result : null);
        r.onerror = () => reject(new Error('read_failed'));
        r.readAsArrayBuffer(file);
    });
}

function scheduleLLMReadAsDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = (e) => resolve(e && e.target ? e.target.result : '');
        r.onerror = () => reject(new Error('read_failed'));
        r.readAsDataURL(file);
    });
}

function scheduleLLMLoadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image_decode_failed'));
        img.src = dataUrl;
    });
}

async function scheduleLLMPackImageDataUrlForLLM(dataUrl, opts = {}) {
    const img = await scheduleLLMLoadImageFromDataUrl(dataUrl);
    const maxSide = Number(opts.maxSide || 1600);
    const mime = String(opts.mime || 'image/jpeg');
    const quality = Math.max(0.5, Math.min(0.95, Number(opts.quality || 0.82)));

    const w0 = img.naturalWidth || img.width || 1;
    const h0 = img.naturalHeight || img.height || 1;
    const scale = Math.min(1, maxSide / Math.max(w0, h0));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    const outUrl = canvas.toDataURL(mime, quality);
    return { dataUrl: outUrl, width: w, height: h };
}

function scheduleLLMLoadScriptOnce(src, id, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        if (typeof document === 'undefined') return reject(new Error('no_dom'));
        if (id) {
            const existing = document.getElementById(id);
            if (existing) {
                if (typeof pdfjsLib !== 'undefined') return resolve(true);

                let done = false;
                const timer = setTimeout(() => {
                    if (done) return;
                    done = true;
                    try { existing.remove(); } catch (_) { }
                    reject(new Error('script_load_timeout:' + src));
                }, timeoutMs);

                const cleanup = () => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                };

                existing.addEventListener('load', () => {
                    cleanup();
                    resolve(true);
                }, { once: true });

                existing.addEventListener('error', () => {
                    cleanup();
                    try { existing.remove(); } catch (_) { }
                    reject(new Error('script_load_failed:' + src));
                }, { once: true });

                return;
            }
        }

        const s = document.createElement('script');
        if (id) s.id = id;
        s.src = src;
        s.async = true;
        let done = false;

        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            s.remove();
            reject(new Error('script_load_timeout:' + src));
        }, timeoutMs);

        s.onload = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            resolve(true);
        };
        s.onerror = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            s.remove();
            reject(new Error('script_load_failed:' + src));
        };

        document.head.appendChild(s);
    });
}

function scheduleLLMImportModuleWithTimeout(url, timeoutMs = 15000) {
    const src = String(url || '').trim();
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
            if (done) return;
            done = true;
            reject(new Error('module_load_timeout:' + src));
        }, Math.max(1, parseInt(timeoutMs || 0, 10) || 15000));

        Promise.resolve()
            .then(() => import(src))
            .then((mod) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(mod);
            })
            .catch((e) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                const msg = (e && e.message) ? e.message : String(e);
                reject(new Error('module_load_failed:' + src + ':' + msg));
            });
    });
}

function scheduleLLMConfigurePdfJsWorker(workerUrl) {
    if (typeof pdfjsLib === 'undefined' || !pdfjsLib || !pdfjsLib.GlobalWorkerOptions) return;

    const wurl = String(workerUrl || '').trim();
    if (!wurl) return;

    const isMjs = /\.mjs(\?|#|$)/i.test(wurl);
    if (isMjs && typeof Worker !== 'undefined') {
        try {
            const w = new Worker(wurl, { type: 'module' });
            pdfjsLib.GlobalWorkerOptions.workerPort = w;
        } catch (_) {
        }
    }

    pdfjsLib.GlobalWorkerOptions.workerSrc = wurl;
}

async function scheduleLLMEnsurePdfJsAsync() {
    if (typeof pdfjsLib !== 'undefined' && pdfjsLib) {
        const hasWorker = !!(pdfjsLib.GlobalWorkerOptions && (pdfjsLib.GlobalWorkerOptions.workerSrc || pdfjsLib.GlobalWorkerOptions.workerPort));
        if (pdfjsLib.GlobalWorkerOptions && !hasWorker) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js';
        }
        return true;
    }

    const key = '__scheduleLLMPdfJsPromise';
    if (typeof window !== 'undefined' && window[key]) {
        try { return await window[key]; } catch { return false; }
    }

    const urls = [
        { kind: 'module', lib: '/pdf.mjs', worker: '/pdf.worker.mjs' },
        { kind: 'module', lib: '/pdf.min.mjs', worker: '/pdf.worker.min.mjs' },
        { kind: 'script', lib: '/pdf.min.js', worker: '/pdf.worker.min.js' },
        { kind: 'script', lib: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.js', worker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js' },
        { kind: 'module', lib: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.mjs', worker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.mjs' },
        { kind: 'module', lib: 'https://unpkg.com/pdfjs-dist@4.0.379/build/pdf.mjs', worker: 'https://unpkg.com/pdfjs-dist@4.0.379/build/pdf.worker.mjs' }
    ];

    const p = (async () => {
        let lastErr = '';
        for (const u of urls) {
            try {
                if (u.kind === 'module') {
                    const mod = await scheduleLLMImportModuleWithTimeout(u.lib, 20000);
                    if (typeof window !== 'undefined') window.pdfjsLib = mod;
                } else {
                    await scheduleLLMLoadScriptOnce(u.lib, 'schedulellm-pdfjs');
                }

                if (typeof pdfjsLib !== 'undefined' && pdfjsLib) {
                    scheduleLLMConfigurePdfJsWorker(u.worker);
                    if (typeof window !== 'undefined') window.__scheduleLLMPdfJsLastError = '';
                    return true;
                }

                lastErr = 'pdfjsLib_missing_after_load:' + u.lib;
            } catch (e) {
                lastErr = (e && e.message) ? e.message : String(e);
            }
        }
        if (typeof window !== 'undefined') window.__scheduleLLMPdfJsLastError = lastErr;
        return false;
    })();

    if (typeof window !== 'undefined') window[key] = p;
    try { return await p; } catch { return false; }
}

async function scheduleLLMPdfFirstPageToPngDataUrl(file) {
    const ok = await scheduleLLMEnsurePdfJsAsync();
    if (!ok) throw new Error('pdfjs_not_loaded');

    const buf = await scheduleLLMReadAsArrayBuffer(file);

    const task = pdfjsLib.getDocument({ data: buf });
    let timeout = null;
    const timeoutMs = 20000;
    const timeoutP = new Promise((_, reject) => {
        timeout = setTimeout(async () => {
            try { await task.destroy(); } catch (_) { }
            reject(new Error('pdf_render_timeout'));
        }, timeoutMs);
    });

    const pdf = await Promise.race([task.promise, timeoutP]);
    const totalPages = Math.max(1, parseInt(pdf && pdf.numPages ? pdf.numPages : 1, 10) || 1);
    const page = await Promise.race([pdf.getPage(1), timeoutP]);
    const viewport = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await Promise.race([page.render({ canvasContext: ctx, viewport }).promise, timeoutP]);

    if (timeout) {
        clearTimeout(timeout);
        timeout = null;
    }

    const dataUrl = canvas.toDataURL('image/png');
    return { dataUrl, canvas, totalPages };
}

function scheduleLLMXhrJson(url, body, opts) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body || {});
        let totalBytes = payload.length;
        try {
            if (typeof TextEncoder !== 'undefined') totalBytes = new TextEncoder().encode(payload).length;
        } catch (_) { }

        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.withCredentials = true;
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('X-Timestamp', String(Date.now()));
        xhr.setRequestHeader('X-Nonce', scheduleLLMMakeNonce());
        if (opts && opts.timeoutMs) xhr.timeout = Math.max(1, parseInt(opts.timeoutMs, 10) || 0);

        const onUploadProgress = opts && typeof opts.onUploadProgress === 'function' ? opts.onUploadProgress : null;
        if (xhr.upload && onUploadProgress) {
            let lastTotal = totalBytes;
            xhr.upload.onprogress = (e) => {
                const loaded = Math.max(0, Number(e && e.loaded ? e.loaded : 0));
                const total = Math.max(0, Number(e && e.total ? e.total : totalBytes));
                lastTotal = total || lastTotal;
                onUploadProgress({ loaded, total });
            };
            xhr.upload.onloadend = () => {
                const total = Math.max(0, Number(lastTotal) || totalBytes);
                onUploadProgress({ loaded: total, total });
            };
        }

        xhr.onerror = () => reject(new Error('network_error'));
        xhr.ontimeout = () => reject(new Error('network_timeout'));
        xhr.onload = () => {
            const text = xhr.responseText || '';
            let json = null;
            try { json = text ? JSON.parse(text) : null; } catch { json = null; }
            if (xhr.status < 200 || xhr.status >= 300) {
                const msg = json ? JSON.stringify(json) : text;
                reject(new Error(`API Error: ${xhr.status} - ${msg}`));
                return;
            }
            resolve(json);
        };

        try { xhr.send(payload); } catch (e) { reject(e); }
    });
}

async function scheduleLLMFetchProxyJson(url, body, opts) {
    if (opts && typeof opts.onUploadProgress === 'function') {
        return await scheduleLLMXhrJson(url, body, opts);
    }

    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Timestamp': String(Date.now()),
            'X-Nonce': scheduleLLMMakeNonce()
        },
        credentials: 'include',
        body: JSON.stringify(body || {})
    });

    const text = await resp.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }

    if (!resp.ok) {
        const msg = json ? JSON.stringify(json) : text;
        throw new Error(`API Error: ${resp.status} - ${msg}`);
    }
    return json;
}

function scheduleLLMXhrFormDataJson(url, formData, opts) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.withCredentials = true;

        xhr.setRequestHeader('X-Timestamp', String(Date.now()));
        xhr.setRequestHeader('X-Nonce', scheduleLLMMakeNonce());

        const timeoutMs = (opts && Number(opts.timeoutMs)) ? Number(opts.timeoutMs) : 0;
        if (timeoutMs > 0) xhr.timeout = timeoutMs;

        const onUploadProgress = opts && typeof opts.onUploadProgress === 'function' ? opts.onUploadProgress : null;
        if (onUploadProgress && xhr.upload) {
            let lastLoaded = 0;
            let lastTotal = 0;
            xhr.upload.onprogress = (evt) => {
                if (!evt) return;
                lastLoaded = Math.max(0, Number(evt.loaded) || 0);
                lastTotal = Math.max(0, Number(evt.total) || 0) || lastTotal;
                onUploadProgress({ loaded: lastLoaded, total: lastTotal, done: false });
            };
            xhr.upload.onloadend = () => {
                onUploadProgress({ loaded: lastLoaded, total: lastTotal, done: true });
            };
        }

        xhr.onerror = () => reject(new Error('network_error'));
        xhr.ontimeout = () => reject(new Error('network_timeout'));
        xhr.onload = () => {
            const text = xhr.responseText || '';
            let json = null;
            try { json = text ? JSON.parse(text) : null; } catch { json = null; }
            if (xhr.status < 200 || xhr.status >= 300) {
                const msg = json ? JSON.stringify(json) : text;
                reject(new Error(`API Error: ${xhr.status} - ${msg}`));
                return;
            }
            resolve(json);
        };

        try { xhr.send(formData); } catch (e) { reject(e); }
    });
}

async function scheduleLLMParsePdfToGrid(file, opts) {
    const f = file;
    const name = String(f && f.name ? f.name : '').toLowerCase();
    const isPdf = name.endsWith('.pdf') || String(f && f.type ? f.type : '').toLowerCase() === 'application/pdf';
    if (!f || !isPdf) throw new Error('not_pdf');

    const form = new FormData();
    form.append('file', f, f.name || 'schedule.pdf');

    const out = await scheduleLLMXhrFormDataJson('/api/parse-pdf', form, opts);
    const grid = out && Array.isArray(out.grid) ? out.grid : null;
    if (!Array.isArray(grid) || !grid.every(r => Array.isArray(r))) throw new Error('bad_pdf_grid');

    const hasNonEmpty = grid.some(r => (r || []).some(c => String(c || '').trim()));
    if (hasNonEmpty) return grid;

    const service = window.llmService || (typeof llmService !== 'undefined' ? llmService : null);
    if (!service) throw new Error('pdf_llm_component_missing');

    const baseUrlEl = document.getElementById('llmBaseUrl');
    const apiKeyEl = document.getElementById('llmApiKey');
    const modelEl = document.getElementById('llmModel');

    const config = {
        baseUrl: baseUrlEl ? baseUrlEl.value : '',
        apiKey: apiKeyEl ? apiKeyEl.value : '',
        model: modelEl ? modelEl.value : ''
    };

    const isProxy = /\/api\/llm\/?$/.test((config.baseUrl || '').trim());
    if (!config.baseUrl) throw new Error('pdf_llm_not_configured');
    if (!isProxy && !config.apiKey) throw new Error('pdf_llm_missing_apikey');

    service.updateConfig(config.baseUrl, config.apiKey, config.model);

    const first = await scheduleLLMPdfFirstPageToPngDataUrl(f);
    const packed = await scheduleLLMPackImageDataUrlForLLM(first.dataUrl, { maxSide: 1600, mime: 'image/jpeg', quality: 0.82 });

    const out2 = await service.parseScheduleImageToGrid(packed.dataUrl, { timeoutMs: (opts && opts.timeoutMs) ? opts.timeoutMs : 120000 });
    if (!out2 || out2.error) throw new Error('pdf_llm_failed:' + String(out2 && out2.error ? out2.error : 'unknown'));

    const grid2 = out2 && Array.isArray(out2.grid) ? out2.grid : null;
    if (!Array.isArray(grid2) || !grid2.every(r => Array.isArray(r))) throw new Error('bad_pdf_grid');

    return grid2;
}

async function scheduleLLMParseImageToGrid(file, opts) {
    const f = file;
    const name = String(f && f.name ? f.name : '').toLowerCase();
    const isImage = /\.(png|jpe?g|webp|bmp|tiff?)$/.test(name) || String(f && f.type ? f.type : '').toLowerCase().startsWith('image/');
    if (!f || !isImage) throw new Error('not_image');

    const service = window.llmService || (typeof llmService !== 'undefined' ? llmService : null);
    if (!service) throw new Error('image_llm_component_missing');

    const baseUrlEl = document.getElementById('llmBaseUrl');
    const apiKeyEl = document.getElementById('llmApiKey');
    const modelEl = document.getElementById('llmModel');

    const config = {
        baseUrl: baseUrlEl ? baseUrlEl.value : '',
        apiKey: apiKeyEl ? apiKeyEl.value : '',
        model: modelEl ? modelEl.value : ''
    };

    const isProxy = /\/api\/llm\/?$/.test((config.baseUrl || '').trim());
    if (!config.baseUrl) throw new Error('image_llm_not_configured');
    if (!isProxy && !config.apiKey) throw new Error('image_llm_missing_apikey');

    service.updateConfig(config.baseUrl, config.apiKey, config.model);

    const dataUrl = await scheduleLLMReadAsDataURL(f);
    const packed = await scheduleLLMPackImageDataUrlForLLM(dataUrl, { maxSide: 1600, mime: 'image/jpeg', quality: 0.82 });

    const out = await service.parseScheduleImageToGrid(packed.dataUrl, { timeoutMs: (opts && opts.timeoutMs) ? opts.timeoutMs : 120000 });
    if (!out || out.error) throw new Error('image_llm_failed:' + String(out && out.error ? out.error : 'unknown'));

    const grid = out && Array.isArray(out.grid) ? out.grid : null;
    if (!Array.isArray(grid) || !grid.every(r => Array.isArray(r))) throw new Error('bad_image_grid');
    return grid;
}

async function scheduleLLMOCRToGrid() {
    throw new Error('ocr_removed');
}

function scheduleLLMGetConfig(path) {
    const key = String(path || '').trim();
    if (!key) return null;

    if (key === 'semester.startDate') {
        const input = document.getElementById('semesterStart');
        const v = input && input.value ? String(input.value).trim() : '';
        if (!v) return null;
        const d = new Date(v);
        if (!Number.isFinite(d.getTime())) return null;
        return v;
    }

    return null;
}

function scheduleLLMEnsureUploadedPlaceholderResizeListener() {
    if (typeof window === 'undefined' || !window) return;
    if (window.__scheduleLLMUploadedPlaceholderResizeBound) return;

    window.__scheduleLLMUploadedPlaceholderResizeBound = true;
    window.addEventListener('resize', () => {
        const el = window.__scheduleLLMUploadedPlaceholderEl;
        if (el) scheduleLLMAdjustPlaceholderBox(el);
    }, { passive: true });
}

function scheduleLLMAdjustPlaceholderBox(placeholder, opts) {
    const el = placeholder;
    if (!el) return;

    const run = () => {
        const heights = (opts && typeof opts.getHeights === 'function')
            ? opts.getHeights(el)
            : { clientHeight: el.clientHeight, scrollHeight: el.scrollHeight };

        const ch = heights && Number.isFinite(heights.clientHeight) ? heights.clientHeight : 0;
        const sh = heights && Number.isFinite(heights.scrollHeight) ? heights.scrollHeight : 0;

        if (sh > ch + 1) {
            el.style.minHeight = `${Math.ceil(sh)}px`;
            return;
        }
        if (!opts || !opts.preserveMinHeight) {
            el.style.minHeight = '';
        }
    };

    if (opts && opts.sync) {
        run();
        return;
    }

    if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(run);
        return;
    }

    setTimeout(run, 0);
}

function scheduleLLMOnScheduleFileLoaded(fileName) {
    const els = scheduleLLMUploadEls();
    if (els.fileName) els.fileName.textContent = "已加载: " + fileName;

    const calendarArea = document.getElementById('calendarArea');
    if (calendarArea) {
        const placeholder = calendarArea.querySelector('.placeholder-text');
        if (placeholder) {
            const currentSemesterStartDate = scheduleLLMGetConfig('semester.startDate') || '未设定';
            placeholder.textContent = `课表文件已上传成功，请确认开学第一天日期，并设定节次时间。\n目前开学第一天日期设定为 ${currentSemesterStartDate}`;
            placeholder.classList.add('placeholder-uploaded');
            if (typeof window !== 'undefined' && window) {
                window.__scheduleLLMUploadedPlaceholderEl = placeholder;
            }
            scheduleLLMEnsureUploadedPlaceholderResizeListener();
            scheduleLLMAdjustPlaceholderBox(placeholder);
        }

        const msg = "已成功上传课表[" + fileName + "]";
        let toast = calendarArea.querySelector('.calendar-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'calendar-toast no-print';
            calendarArea.prepend(toast);
        }
        toast.textContent = msg;
        toast.classList.remove('calendar-toast-hide');
        if (window.scheduleLLMUploadMessageTimer) {
            clearTimeout(window.scheduleLLMUploadMessageTimer);
        }
        window.scheduleLLMUploadMessageTimer = setTimeout(() => {
            toast.classList.add('calendar-toast-hide');
        }, 5000);
        if (window.scheduleLLMUploadMessageTimer && typeof window.scheduleLLMUploadMessageTimer.unref === 'function') {
            window.scheduleLLMUploadMessageTimer.unref();
        }

        if (typeof scheduleLLMHideCalendarProgress === 'function') {
            scheduleLLMHideCalendarProgress(1200);
        }
    }
}

async function handleFileUpload(e) {
    const file = e && e.target && e.target.files ? e.target.files[0] : null;
    if (!file) return;

    const els = scheduleLLMUploadEls();
    if (els.fileName) els.fileName.textContent = "正在读取: " + file.name;

    const lowerName = String(file.name || '').toLowerCase();
    const isExcel = lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls');
    const isPdf = lowerName.endsWith('.pdf') || String(file.type || '').toLowerCase() === 'application/pdf';
    const isImage = /\.(png|jpe?g|webp|bmp|tiff?)$/.test(lowerName) || String(file.type || '').toLowerCase().startsWith('image/');

    try {
        scheduleLLMSetCalendarProgress('正在读取文件…', null, null, null, '');

        if (isExcel) {
            scheduleLLMSetUploadPreviewVisible(false);
            scheduleLLMSetUploadProgress('', false);

            const buf = await scheduleLLMReadAsArrayBuffer(file);
            const data = new Uint8Array(buf);

            if (typeof XLSX === 'undefined') {
                throw new Error("XLSX 库未加载，请检查网络或刷新页面");
            }

            workbook = XLSX.read(data, { type: 'array' });
            if (!workbook || !workbook.SheetNames || workbook.SheetNames.length === 0) {
                throw new Error("文件解析失败或无工作表");
            }

            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            rawScheduleData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
            if (!rawScheduleData || rawScheduleData.length === 0) {
                throw new Error("工作表为空");
            }

            console.log("File loaded. Rows:", rawScheduleData.length);
            scheduleLLMSetCalendarProgress('解析完成', 100, null, null, '', 'ok');
            scheduleLLMOnScheduleFileLoaded(file.name);
            return;
        }

        if (!isPdf && !isImage) {
            throw new Error('unsupported_file_type');
        }

        scheduleLLMSetUploadPreviewVisible(true);
        scheduleLLMSetUploadProgress('准备解析…', true);

        let pdfPages = 1;
        if (isPdf) {
            scheduleLLMSetUploadProgress('正在加载 PDF 解析组件', true);
            scheduleLLMSetCalendarProgress('正在加载 PDF 解析组件', null, null, null, '');
            const ok = await scheduleLLMEnsurePdfJsAsync();
            if (ok) {
                scheduleLLMSetUploadProgress('正在渲染 PDF（第1页）…', true);
                scheduleLLMSetCalendarProgress('正在处理文件…', null, null, null, '正在解析第1页/共?页');
                const out = await scheduleLLMPdfFirstPageToPngDataUrl(file);
                pdfPages = out && out.totalPages ? out.totalPages : 1;
                scheduleLLMSetCalendarProgress('正在处理文件…', null, null, null, `正在解析第1页/共${pdfPages}页`);
                if (out.canvas) scheduleLLMShowUploadPreviewCanvas(out.canvas);
            }
        } else {
            const dataUrl = await scheduleLLMReadAsDataURL(file);
            if (dataUrl) scheduleLLMShowUploadPreviewImage(dataUrl);
        }

        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        let lastAt = t0;
        let lastLoaded = 0;
        let speedAvg = 0;
        const extraText = isPdf ? `正在解析第1页/共${pdfPages}页` : (isImage ? '正在解析图片…' : '');

        let parseWaitStarted = false;
        const onUploadProgress = ({ loaded, total, done }) => {
            const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const dt = Math.max(1, now - lastAt);
            const dl = Math.max(0, Number(loaded) - lastLoaded);
            const inst = (dl * 1000) / dt;
            speedAvg = speedAvg ? (speedAvg * 0.8 + inst * 0.2) : inst;
            lastAt = now;
            lastLoaded = Math.max(0, Number(loaded) || 0);

            const tt = Math.max(0, Number(total) || 0);
            const ll = Math.max(0, Number(loaded) || 0);
            const hasTotal = tt > 0 && ll <= tt;

            if ((done || (hasTotal && ll >= tt)) && !parseWaitStarted) {
                parseWaitStarted = true;
                scheduleLLMSetUploadProgress('上传完成，正在解析…', true);
                scheduleLLMCalendarFakeProgressStart(hasTotal ? 60 : 0);
                scheduleLLMSetCalendarProgress('正在解析课表…', null, null, null, extraText);
                return;
            }

            if (!hasTotal) {
                scheduleLLMSetCalendarProgress('正在上传文件…', null, speedAvg, null, extraText);
                scheduleLLMSetUploadProgress('正在上传文件…', true);
                return;
            }

            const pct = Math.max(0, Math.min(100, Math.round((ll / tt) * 100)));
            const mappedPct = Math.min(60, Math.round(pct * 0.6));
            const eta = (tt > 0 && speedAvg > 1) ? (Math.max(0, tt - ll) / speedAvg) : null;

            scheduleLLMSetCalendarProgress(`正在上传文件… ${pct}%`, mappedPct, speedAvg, eta, extraText);
            scheduleLLMSetUploadProgress(`正在上传文件… ${pct}%`, true);
        };

        scheduleLLMSetCalendarProgress('正在上传文件…', null, null, null, extraText);
        scheduleLLMSetUploadProgress('正在上传文件…', true);

        const grid = isPdf
            ? await scheduleLLMParsePdfToGrid(file, { onUploadProgress, timeoutMs: 120000 })
            : await scheduleLLMParseImageToGrid(file, { onUploadProgress, timeoutMs: 120000 });
        rawScheduleData = grid;
        workbook = null;

        console.log("PDF parsed. Rows:", rawScheduleData.length);
        scheduleLLMSetUploadProgress('解析完成', true);
        scheduleLLMSetCalendarProgress('解析完成', 100, null, null, '', 'ok');
        scheduleLLMHideCalendarProgress(1500);
        scheduleLLMOnScheduleFileLoaded(file.name);
    } catch (err) {
        console.error(err);
        const msg = (err && err.message) ? err.message : String(err);
        let friendly = msg;
        if (msg === 'unsupported_file_type') {
            friendly = '当前仅支持上传 Excel（.xlsx/.xls）、PDF（.pdf）或图片（.png/.jpg/.jpeg/.webp/.bmp/.tif/.tiff）';
        } else if (msg === 'not_pdf') {
            friendly = '当前仅支持上传 PDF（.pdf）';
        } else if (msg === 'not_image') {
            friendly = '当前仅支持上传图片（.png/.jpg/.jpeg/.webp/.bmp/.tif/.tiff）';
        } else if (msg === 'bad_pdf_grid') {
            friendly = 'PDF 解析未提取到可用表格（建议使用可复制文字的课表 PDF，或提高 PDF 清晰度后重试）';
        } else if (msg === 'pdf_llm_component_missing') {
            friendly = 'LLM 组件未加载（请确认 llm_parser.js 已在页面引入）';
        } else if (msg === 'pdf_llm_not_configured') {
            friendly = '未配置 LLM 接口地址（建议使用后端 /api/llm）';
        } else if (msg === 'pdf_llm_missing_apikey') {
            friendly = '直连模式缺少 API Key（生产环境建议使用后端 /api/llm 代理）';
        } else if (msg.startsWith('pdf_llm_failed:')) {
            friendly = 'LLM PDF(第1页)识别失败：' + msg.slice('pdf_llm_failed:'.length);
        } else if (msg === 'bad_image_grid') {
            friendly = '图片解析未提取到可用表格（建议提高图片清晰度或使用 PDF/Excel）';
        } else if (msg === 'pdfjs_not_loaded') {
            friendly = 'PDF 预览组件加载失败（不影响解析）。可尝试：1) 刷新重试；2) 换网络/关闭拦截插件；3) 部署同源 /pdf.min.js 与 /pdf.worker.min.js（离线/内网推荐）。';
        } else if (msg === 'pdf_render_timeout') {
            friendly = 'PDF 预览渲染超时（不影响解析）。建议：换更小/更清晰的 PDF。';
        } else if (msg === 'network_timeout') {
            friendly = '网络请求超时（上传或解析耗时过长）。建议：换更小/更清晰的文件，或稍后重试。';
        }

        if (els.fileName) els.fileName.textContent = "读取失败: " + friendly;
        scheduleLLMSetUploadProgress('识别失败：' + friendly, true);
        scheduleLLMSetCalendarProgress('识别失败', null, null, null, friendly, 'err');
        alert("读取文件出错: " + friendly);
        rawScheduleData = [];
        workbook = null;
    }
}

// Core Parsing Logic
function scheduleLLMSanitizePeriodRange(periodRange) {
    if (!periodRange) return "";

    const raw = String(periodRange).trim();
    if (!raw) return "";

    // 修正 OCR/LLM 可能输出的“第0节/0-2节”等无效节次：节次编号强制从 1 开始
    let s = raw
        .replace(/[（(]/g, '')
        .replace(/[）)]/g, '')
        .replace(/[节课]/g, '')
        .replace(/第/g, '')
        .replace(/[~～—–−]/g, '-')
        .replace(/至/g, '-')
        .replace(/[，、;；]/g, ',');

    const parts = s.split(',').map(x => x.trim()).filter(Boolean);
    if (!parts.length) parts.push(s);

    const normParts = parts.map(part => {
        const toP = (n) => {
            const v = parseInt(n, 10);
            if (!Number.isFinite(v)) return 1;
            return v >= 1 ? v : 1;
        };

        const mRange = String(part).match(/(\d+)\s*-\s*(\d+)/);
        if (mRange) {
            const a0 = toP(mRange[1]);
            let b0 = toP(mRange[2]);
            if (b0 < a0) b0 = a0;
            return a0 === b0 ? String(a0) : `${a0}-${b0}`;
        }

        const mSingle = String(part).match(/(\d+)/);
        if (mSingle) return String(toP(mSingle[1]));

        return part;
    });

    return normParts.join(',');
}

function parseCourseString(cellContent) {
    if (!cellContent || typeof cellContent !== 'string') return [];

    // Pre-process: normalize OCR text and delimiters
    let cleanContent = normalizeOCRText(cellContent);
    cleanContent = cleanContent
        .replace(/◇/g, ' / ')
        .replace(/[《〈]/g, '(')
        .replace(/[》〉]/g, ')')
        .replace(/(\d+\s*[-~]\s*\d+|\d+)\s*[\r\n]+\s*周/g, '$1周');

    const independentCourses = [];

    // Phase 1: build week index table (debug / segmentation)
    const weekIndex = [];
    const weekGlobal = /(\d+\s*[-~]\s*\d+|\d+)\s*周/g;
    let wm;
    while ((wm = weekGlobal.exec(cleanContent)) !== null) {
        weekIndex.push({ idx: wm.index, text: wm[0] });
    }

    // Phase 2: segment courses by locating repeated "Name/...周" entry starts
    const entryRe = /(^|[\r\n]+)\s*([^\/\r\n]{2,}?)\s*\/\s*(?:\d{6,}\s*\/\s*)?(?:[\(（]?\s*\d+\s*[-~]\s*\d+\s*节[\)）]?\s*)?(?:\d+\s*[-~]\s*\d+|\d+)\s*周/g;
    const starts = [];
    let em;
    while ((em = entryRe.exec(cleanContent)) !== null) {
        starts.push(em.index + (em[1] ? em[1].length : 0));
    }

    if (starts.length > 1) {
        for (let i = 0; i < starts.length; i++) {
            const seg = cleanContent.slice(starts[i], starts[i + 1] || cleanContent.length).trim();
            if (seg) independentCourses.push(seg);
        }
    } else {
        // Fallback: line-buffer segmentation when entry starts are unclear
        const rawLines = cleanContent.split(/\r?\n/).map(s => s.trim()).filter(s => s.length > 0);
        let buffer = "";
        let bufferHasWeek = false;
        const hasWeekInfo = (str) => /(\d+[-~]\d+|\d+)周/.test(str);
        rawLines.forEach(line => {
            const lineHasWeek = hasWeekInfo(line);
            if (lineHasWeek && bufferHasWeek) {
                independentCourses.push(buffer);
                buffer = line;
                bufferHasWeek = true;
                return;
            }
            buffer = buffer.trim();
            if (buffer && !buffer.endsWith('/') && !buffer.endsWith('\n')) buffer += " " + line;
            else buffer = buffer + line;
            if (lineHasWeek) bufferHasWeek = true;
        });
        if (buffer) independentCourses.push(buffer);
    }

    const parsedCourses = [];

    independentCourses.forEach(courseStr => {
        // Smart Parsing: Handle variable formats
        // Format A: Name/Code/Weeks/Location/... (Standard)
        // Format B: Name/Weeks/Location (Simplified)
        // Format C: Missing slashes? (Not handled yet, assuming at least some delimiters)

        const courseStrClean = String(courseStr).replace(/[\r\n]+/g, "");

        // Pre-split handling: if "/" is missing but newlines were there (now spaces), 
        // we might have "Name 1-16周 Location". 
        // Let's ensure slashes exist around week info if missing.
        let normalizedStr = courseStrClean;
        const weekRegex = /(\d+[-~]\d+|\d+)周/;
        if (!normalizedStr.includes('/') && weekRegex.test(normalizedStr)) {
            normalizedStr = normalizedStr.replace(weekRegex, (match) => ` / ${match} / `);
        }

        // Also handle colons ':' and semicolons ';' as separators if they appear between what looks like class names
        // But simply replacing all colons might break times like 12:00 (though rare in course cells)
        // For now, let's treat colons and semicolons as potential delimiters during split or inner loop processing.
        // Actually, easiest is to replace colons/semicolons with slashes BEFORE split, 
        // IF they are not part of "人数:30" pattern.
        normalizedStr = normalizedStr.replace(/[:：;；]/g, '/'); 

        const parts = normalizedStr.split('/').map(s => s.trim()).filter(s => s.length > 0);

        let name = parts[0];
        let weeks = [];
        let location = "";
        let className = "";
        let periodRange = "";
        let weeksRaw = "";

        // Strategy: Find "Week" part specifically
        // It usually contains digit + "周"
        let weekPartIdx = -1;
        for (let i = 0; i < parts.length; i++) {
            if (weekRegex.test(parts[i])) {
                weekPartIdx = i;
                break;
            }
        }

        if (weekPartIdx !== -1) {
            // Found Weeks
            weeksRaw = parts[weekPartIdx];
            weeks = parseWeekString(parts[weekPartIdx]);

            // Name discovery:
            if (weekPartIdx > 0) {
                name = parts[0];
            } else if (weekPartIdx === 0) {
                // Case: "Software Engineering 1-16周 / Location"
                // Split parts[0] by the week regex
                const weekMatch = parts[0].match(weekRegex);
                if (weekMatch) {
                    const weekStr = weekMatch[0];
                    const splitPos = parts[0].indexOf(weekStr);
                    name = parts[0].substring(0, splitPos).trim() || "未知课程";
                } else {
                    name = "未知课程";
                }
            }

            // Location, Class Name, and "Other" info discovery
            const locs = [];
            const others = [];
            let prevWasBuildingOnly = false;

            for (let i = weekPartIdx + 1; i < parts.length; i++) {
                const p = parts[i];
                if (!p) continue;

                // 1. Identify Class Name
                // Rule: Contains digits/major + "班"/"级"/"专业", excludes "人数"
                const isPeopleCount = /人(数)?[:：°\s]*\d+|\d+\s*人/.test(p);
                // Enhanced class detection from instruction
                const isClassLike = (/((\d+|专业)[\s\S]*?[班级])/.test(p) || /^[A-Za-z0-9\u4e00-\u9fa5]+班$/.test(p)) && !isPeopleCount;

                if (isClassLike) {
                    if (className) {
                        className += "," + p;
                    } else {
                        className = p;
                    }
                    prevWasBuildingOnly = false;
                } else {
                    // 2. Identify Location
                    const token = String(p).trim();
                    const isLocationKeyword = /[楼室馆区教厅场苑基地中心工程]/.test(token);
                    const blacklistRegex = /(专业|导论|概论|基础|原理|必修|选修|考查|考试|讲课)/;
                    const hitsBlacklist = blacklistRegex.test(token);

                    const hasDigit = /\d/.test(token);
                    const hasLetter = /[A-Za-z]/.test(token);
                    const isPureDigit = /^\d+$/.test(token);

                    // Only treat pure-digit room numbers as location when they immediately follow a building-only token.
                    const isStandaloneRoomAfterBuilding = prevWasBuildingOnly && /^\d{3,4}$/.test(token);

                    const endsWithStrongSuffix = /[楼室馆区教厅场苑基地中心]$/.test(token);

                    let isLocation = false;
                    if (hasLetter && hasDigit) isLocation = true; // e.g. S103 / N608 / A101
                    else if (isStandaloneRoomAfterBuilding) isLocation = true; // e.g. 北苑电影大楼 + 414
                    else if (endsWithStrongSuffix) isLocation = true;
                    else if (isLocationKeyword && !hitsBlacklist) isLocation = true;

                    if (isPureDigit && !isStandaloneRoomAfterBuilding) {
                        // Likely teacher id / sequence / credit / other metadata (e.g. 426/0)
                        isLocation = false;
                    }

                    if (isLocation) {
                        locs.push(token);
                        prevWasBuildingOnly = isLocationKeyword && !hasDigit;
                    } else {
                        others.push(token);
                        prevWasBuildingOnly = false;
                    }
                }
            }
            location = locs.join(" ");
            // Note: 'others' array is available if we want to extract teacher later. 
            // e.g. const teacher = others.join(" ");

            // Try to extract period info from the week string BEFORE it was parsed/cleaned?
            // Actually parseWeekString cleaned it. 
            // We should check parts[weekPartIdx] for period info like "(1-2节)"
            const weekStrRaw = parts[weekPartIdx];
            const pMatch = weekStrRaw.match(/(\d+)\s*[-~]\s*(\d+)\s*节/);
            if (pMatch) {
                periodRange = `${pMatch[1]}-${pMatch[2]}`;
            } else {
                const pMatch2 = weekStrRaw.match(/\(([^)]*?)节\)/);
                if (pMatch2) periodRange = pMatch2[1];
            }

            periodRange = scheduleLLMSanitizePeriodRange(periodRange);
        } else {
            // FALLBACK: If no "X周" found
            console.warn("No weeks found for course:", courseStr);
            weeks = [];
            location = parts[1] || ""; 
            className = parts[2] || "";
        }

        // 2. Standardize all fields (Location, Name, ClassName, etc.)
        // This replaces individual simplify calls and ensures consistency
        const baseCourse = {
            rawName: name,
            displayName: name,
            weeks: Array.isArray(weeks) ? weeks : parseWeekString(weeks || ""),
            weeksRaw: weeksRaw,
            location: location,
            className: className,
            periodRange: periodRange,
            teacher: "",
            rawStr: courseStr
        };

        baseCourse.confidence = (
            (baseCourse.displayName && baseCourse.displayName !== "未知课程" ? 0.3 : 0) +
            (baseCourse.weeks && baseCourse.weeks.length ? 0.3 : 0) +
            (baseCourse.location ? 0.2 : 0) +
            (baseCourse.className ? 0.1 : 0) +
            (baseCourse.periodRange ? 0.1 : 0)
        );

        const stdCourse = standardizeCourseData(baseCourse);
        if (typeof window !== 'undefined' && window.__SCHEDULELLM_DEBUG_PARSE) {
            stdCourse._debug = { weekIndex: weekIndex, segmentCount: independentCourses.length };
        }

        parsedCourses.push(stdCourse);
    });

    return parsedCourses;
}

function standardizeCourseData(course) {
    // 1. Name: Remove all whitespace
    if (course.displayName) {
        course.displayName = simplifyName(course.displayName).replace(/\s+/g, "");
    }
    
    // 2. ClassName: Remove all whitespace, uppercase
    if (course.className) {
        course.className = course.className.replace(/^[\(（]/, '').replace(/[\)）]$/, ''); // Remove parens first
        course.className = course.className.replace(/\s+/g, "").toUpperCase();
    }

    // 3. Location, Building, Room
    // Extract components and reconstruct standardized location
    const locInfo = standardizeLocation(course.location);
    course.location = locInfo.location;
    course.building = locInfo.building;
    course.room = locInfo.room;

    // 4. Teacher: Remove all whitespace
    if (course.teacher) {
        course.teacher = course.teacher.replace(/\s+/g, "");
    } else {
        course.teacher = ""; // Ensure field exists
    }

    // Logging for audit
    // console.log("[Standardization]", course.displayName, course.location, course.className);

    return course;
}

function standardizeLocation(loc) {
    if (!loc) return { location: "待通知", building: "", room: "" };

    let s = loc;
    
    // 1. Basic Cleaning
    s = s.replace(/实验实训中心/g, "实训楼");
    s = s.replace(/(校区|场地|地点|场所)[：:]\s*/g, "");

    s = s.replace(/北苑电影大楼/g, "北苑电影");
    s = s.replace(/学术中心/g, "学术楼");
    s = s.replace(/南苑综合大楼/g, "南苑综合");
    s = s.replace(/第二教学楼/g, "二教");
    s = s.replace(/艺术大楼/g, "艺术楼");
    s = s.replace(/传媒大楼/g, "传媒楼");
    s = s.replace(/体育训练馆/g, "体育馆");
    s = s.replace(/创新创业大厦/g, "创新楼");
    s = s.replace(/电子信息大楼/g, "电子楼");

    // 2. Remove Campus Noise
    const campusNoise = ["桂林洋", "府城", "龙昆南", "校区"];
    campusNoise.forEach(noise => {
        s = s.replace(new RegExp(noise + "(校区)?", 'g'), "");
    });
    s = s.replace(/校区[：:]?/g, "");

    // 3. Remove ALL whitespace to ensure clean parsing
    s = s.replace(/\s+/g, "");

    s = s.replace(/一般(?=[A-Za-z]?\d)/g, "一教");
    s = s.replace(/二般(?=[A-Za-z]?\d)/g, "二教");
    s = s.replace(/一(?:栋|棟)(?=[A-Za-z]?\d)/g, "一教");
    s = s.replace(/二(?:栋|棟)(?=[A-Za-z]?\d)/g, "二教");

    // 4. Split Building and Room
    const buildingSuffixes = "楼|教|馆|室|厅|部|大楼|场|苑|中心|程|基地";

    const candidates = [];
    const pushCandidates = (re, kind, baseScore) => {
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(s)) !== null) {
            const v = m[1];
            if (!v) continue;
            const idx = m.index;
            if (v.length > 10) continue;
            if (/^\d+$/.test(v) && v.length < 3) continue;
            let score = baseScore;
            if (/^[A-Za-z]/.test(v)) score += 3;
            if (/\d{3,4}$/.test(v)) score += 1;
            if (/\d{2}[\u4e00-\u9fa5]/.test(s.slice(idx + v.length, idx + v.length + 3))) score += 4;
            candidates.push({ idx, v, kind, score });
        }
    };

    pushCandidates(/([A-Za-z]{1,3}\d{2,4})(?=\d{2}[\u4e00-\u9fa5])/g, 'alphaNum_yearMajor', 30);
    pushCandidates(/(\d{3,4})(?=\d{2}[\u4e00-\u9fa5])/g, 'num_yearMajor', 24);
    pushCandidates(/([A-Za-z]{1,3}\d{2,4})(?!\d)/g, 'alphaNum', 18);
    pushCandidates(/(\d{3,4})(?!\d)/g, 'num', 14);
    pushCandidates(/(\d{1,4}[A-Za-z]{1,2})(?=\D|$)/g, 'numAlpha', 12);

    let best = null;
    for (const c of candidates) {
        if (!best) {
            best = c;
            continue;
        }
        if (c.score > best.score) best = c;
        else if (c.score === best.score && c.idx < best.idx) best = c;
    }

    let building = "";
    let room = "";
    let truncatedSuffix = "";

    if (best) {
        room = best.v;
        const roomEndIdx = best.idx + room.length;
        building = s.substring(0, best.idx);
        truncatedSuffix = s.substring(roomEndIdx);

        if (truncatedSuffix && /^\d{2}[\u4e00-\u9fa5]/.test(truncatedSuffix)) {
            if (typeof window !== 'undefined' && window.__SCHEDULELLM_DEBUG_PARSE) {
                console.warn('[LocationTruncateAfterRoom]', { input: loc, raw: s, building, room, truncatedSuffix });
            }
        }
    } else {
        building = s;
    }

    // Further clean building
    // If building ended with "楼" or similar, it's good.
    // If building is empty but room exists? (e.g. "101") -> Building unknown.
    
    const buildingRoom = building + room;
    let fullLocation = buildingRoom || "待通知";

    if (building && room && building.endsWith(room)) {
        if (typeof window !== 'undefined' && window.__SCHEDULELLM_DEBUG_PARSE) {
            console.warn("[LocationDupStandardize]", { input: loc, building, room, full: buildingRoom });
        }
        fullLocation = building;
    }

    return {
        location: fullLocation,
        building: building,
        room: room,
        _truncated: truncatedSuffix
    };
}

function mergeBuildingRoom(building, room) {
    let b = String(building || "").replace(/\s+/g, "");
    let r = String(room || "").replace(/\s+/g, "");

    if (!b || !r) return b + r;

    r = r.replace(/^([A-Za-z])\1(\d)/, "$1$2");

    const m = r.match(/^([A-Za-z])\d/);
    if (m && b.endsWith(m[1])) {
        b = b.slice(0, -1);
    }

    if (b && r && b.endsWith(r)) {
        const merged = b;
        if (typeof window !== 'undefined' && window.__SCHEDULELLM_DEBUG_PARSE) {
            console.warn("[LocationDupMerge]", { building: b, room: r, merged });
        }
        return merged;
    }

    return b + r;
}

function simplifyLocation(loc) {
    // Legacy wrapper for compatibility
    return standardizeLocation(loc).location;
}

function parseWeekString(str) {
    const utils = (typeof window !== 'undefined' && window.ScheduleLLMTimeUtils) ? window.ScheduleLLMTimeUtils : null;
    if (utils && typeof utils.parseWeekString === 'function') {
        return utils.parseWeekString(str);
    }

    // Example: "(1-2节)2-6周,8-12周(双)"
    // Or just "2-6周"
    // Normalize first
    let cleanStr = normalizeOCRText(str);

    // Remove anything inside parens that looks like period "1-2节"
    cleanStr = cleanStr.replace(/\([^)]*节\)/g, "");

    cleanStr = cleanStr
        .replace(/(\d+(?:-\d+)?)\s*周\s*(单|双)(?=[,，\s]|$)/g, '$1周($2)')
        .replace(/(\d+(?:-\d+)?)\s*(单周|双周)(?=[,，\s]|$)/g, (_, a, b) => `${a}周(${b === '单周' ? '单' : '双'})`);

    // Logic: Split by comma
    const parts = cleanStr.split(/[,，]/); // Handle Chinese comma too
    let weekSet = new Set();

    parts.forEach(part => {
        // Match patterns: "2-6周", "8-12周(双)", "5周"
        // Also support missing "周" if it's clearly a range like "1-16"
        // Scan all candidates inside the same part, because part may contain course codes like (43011091)
        const weekRe = /(\d+)(?:-(\d+))?(?:周|W|w)?(?:\((单|双)\))?/g;
        let match;

        while ((match = weekRe.exec(part)) !== null) {
            if (!match[0]) continue;

            // If it doesn't explicitly look like week info (no 周/W/w and no range), skip it.
            // This prevents course codes / counts from blocking later valid week ranges.
            const token = match[0];
            const hasWeekMark = /[周Ww]/.test(token);
            const hasRange = !!match[2];
            if (!hasWeekMark && !hasRange) continue;

            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : start;
            const type = match[3];

            // Sanity check: weeks shouldn't be > 30 usually
            // IMPORTANT: don't return; just skip this candidate and keep scanning.
            if (!Number.isFinite(start) || start <= 0 || start > 30) continue;
            if (!Number.isFinite(end) || end <= 0 || end > 30) continue;

            for (let i = start; i <= end; i++) {
                if (type === '单' && i % 2 === 0) continue;
                if (type === '双' && i % 2 !== 0) continue;
                weekSet.add(i);
            }
        }
    });

    return Array.from(weekSet).sort((a, b) => a - b);
}

function simplifyName(name) {
    if (!name) return "";

    // 1. Find the first occurrence of balanced brackets (English or Chinese)
    // We want to keep everything from the start until the end of the FIRST bracketed pair.
    const match = name.match(/^(.*?[[\(（][^()（）]*[\)）])/);

    let s = name;
    if (match && match[1]) {
        s = match[1];
    }

    // 2. Clean up trailing spaces or non-word delimiters
    s = s.replace(/[\s\-_/]+$/, "");

    // 3. Remove ALL whitespace for standardization
    return s.replace(/\s+/g, "");
}

function normalizeOCRText(str) {
    if (!str) return "";
    return str
        .replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 65248))
        .replace(/[Ａ-Ｚａ-ｚ]/g, s => String.fromCharCode(s.charCodeAt(0) - 65248))
        .replace(/（/g, "(").replace(/）/g, ")")
        .replace(/：/g, ":")
        .replace(/—/g, "-")
        .replace(/－/g, "-")
        .replace(/(\d+)\s*[\n\r]*[-~～]\s*[\n\r]*\s*(\d+)/g, "$1-$2")
        .replace(/(\d+)\s*[\n\r]+\s*(\d+)/g, "$1$2")
        .replace(/～/g, "-")
        .trim();
}

function canonicalizeLLMCellKey(cell) {
    const s = normalizeOCRText(String(cell || "").trim());
    return s.replace(/◇/g, ' / ').replace(/[:：;；]/g, '/');
}

const SCHEDULELLM_LOG_STORAGE_KEY = "schedulellm_logs_v1";
const SCHEDULELLM_LOG_MAX = 500;

function scheduleLLMHash(str) {
    const s = String(str || "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
}

function scheduleLLMGetLogs() {
    try {
        const raw = localStorage.getItem(SCHEDULELLM_LOG_STORAGE_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (_) {
        return [];
    }
}

function scheduleLLMSetLogs(logs) {
    try {
        localStorage.setItem(SCHEDULELLM_LOG_STORAGE_KEY, JSON.stringify(logs));
    } catch (_) {
    }
}

function scheduleLLMLog(entry) {
    const safe = entry && typeof entry === 'object' ? { ...entry } : { msg: String(entry) };
    if (safe.apiKey) delete safe.apiKey;
    safe.ts = safe.ts || new Date().toISOString();
    const logs = scheduleLLMGetLogs();
    logs.push(safe);
    if (logs.length > SCHEDULELLM_LOG_MAX) logs.splice(0, logs.length - SCHEDULELLM_LOG_MAX);
    scheduleLLMSetLogs(logs);
}

function scheduleLLMSummarizeLogs() {
    const logs = scheduleLLMGetLogs();
    const byType = {};
    const byReason = {};
    for (const l of logs) {
        const t = l.type || "unknown";
        byType[t] = (byType[t] || 0) + 1;
        if (l.reason) byReason[l.reason] = (byReason[l.reason] || 0) + 1;
    }
    return { total: logs.length, byType, byReason };
}

function scheduleLLMExportLogs() {
    const logs = scheduleLLMGetLogs();
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), logs }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `schedulellm-logs-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

function scheduleLLMClearLogs() {
    try { localStorage.removeItem(SCHEDULELLM_LOG_STORAGE_KEY); } catch (_) {}
}

if (typeof window !== 'undefined') {
    window.scheduleLLMGetLogs = scheduleLLMGetLogs;
    window.scheduleLLMSummarizeLogs = scheduleLLMSummarizeLogs;
    window.scheduleLLMExportLogs = scheduleLLMExportLogs;
    window.scheduleLLMClearLogs = scheduleLLMClearLogs;
}

let scheduleLLMRecognizedItems = [];

function scheduleLLMProgressEls() {
    const host = document.getElementById('llmProgressHost');
    if (!host) return null;
    return {
        host,
        fill: document.getElementById('llmProgressFill'),
        pct: document.getElementById('llmProgressPct'),
        count: document.getElementById('llmProgressCount'),
        text: document.getElementById('llmProgressText'),
        icon: document.getElementById('llmProgressIcon'),
        retry: document.getElementById('llmProgressRetry'),
        err: document.getElementById('llmProgressError'),
        errText: document.getElementById('llmProgressErrorText'),
        errRetry: document.getElementById('llmProgressErrorRetry'),
        panel: document.getElementById('llmRecognizedPanel'),
        summary: document.getElementById('llmRecognizedSummary'),
        list: document.getElementById('llmRecognizedList'),
        detail: document.getElementById('llmCourseDetail')
    };
}

function scheduleLLMProgressSetVisible(visible) {
    const els = scheduleLLMProgressEls();
    if (!els) return;
    els.host.style.display = visible ? 'block' : 'none';
}

function scheduleLLMProgressSetRunning(running) {
    const els = scheduleLLMProgressEls();
    if (!els) return;
    els.host.classList.toggle('running', !!running);
    els.host.classList.toggle('done', false);
}

function scheduleLLMProgressSetIcon(kind, text) {
    const els = scheduleLLMProgressEls();
    if (!els || !els.icon) return;
    if (!kind) {
        els.icon.style.display = 'none';
        els.icon.className = 'llm-progress-icon';
        els.icon.textContent = '';
        return;
    }
    els.icon.style.display = 'inline-flex';
    els.icon.className = `llm-progress-icon ${kind}`;
    els.icon.textContent = text || (kind === 'done' ? '✓' : '!');
}

function scheduleLLMProgressSetText(text) {
    const els = scheduleLLMProgressEls();
    if (!els || !els.text) return;
    els.text.textContent = String(text || '');
}

function scheduleLLMProgressSetProgress(processed, total, extractedCourses) {
    const els = scheduleLLMProgressEls();
    if (!els) return;
    const t = Math.max(0, parseInt(total || 0, 10));
    const p = Math.max(0, Math.min(t || 0, parseInt(processed || 0, 10)));
    const pct = t > 0 ? Math.round((p / t) * 100) : 0;
    if (els.fill) els.fill.style.width = `${pct}%`;
    if (els.pct) els.pct.textContent = `${pct}%`;
    if (els.count) {
        const courses = Math.max(0, parseInt(extractedCourses || 0, 10));
        els.count.textContent = `${p}/${t} · ${courses}门课`;
    }
}

function scheduleLLMProgressReset() {
    const els = scheduleLLMProgressEls();
    if (!els) return;
    scheduleLLMRecognizedItems = [];
    if (els.list) els.list.innerHTML = '';
    if (els.detail) {
        els.detail.innerHTML = '';
        els.detail.style.display = 'none';
    }
    if (els.summary) els.summary.textContent = '0';
    if (els.err) els.err.style.display = 'none';
    scheduleLLMProgressSetIcon(null);
    scheduleLLMProgressSetText('准备中');
    scheduleLLMProgressSetProgress(0, 0, 0);
    els.host.classList.toggle('done', false);
}

function scheduleLLMProgressShowError(message) {
    const els = scheduleLLMProgressEls();
    if (!els || !els.err || !els.errText) return;
    els.errText.textContent = String(message || '识别失败');
    els.err.style.display = 'flex';
    scheduleLLMProgressSetIcon('err', '!');
}

function scheduleLLMProgressHideError() {
    const els = scheduleLLMProgressEls();
    if (!els || !els.err) return;
    els.err.style.display = 'none';
}

function scheduleLLMResetLayoutMode() {
    const els = scheduleLLMProgressEls();
    if (!els) return;

    // Restore Panel to Host if needed (revert move)
    if (els.panel && els.host && els.panel.parentElement !== els.host) {
        els.host.appendChild(els.panel);
        els.panel.classList.remove('moved-below-calendar');
    }

    // Restore Progress Visibility
    els.host.classList.remove('fade-out');
    els.host.style.display = '';
    els.host.style.opacity = '';

    els.host.classList.remove('sidebar-mode', 'drawer-mode', 'post-mode');
    const card = els.host.querySelector('.llm-progress-card');
    if (card) card.style.display = '';
    if (els.panel) els.panel.open = true;
}

function scheduleLLMEnterPostMode(enabled) {
    const els = scheduleLLMProgressEls();
    if (!els) return;
    scheduleLLMResetLayoutMode();
    if (!enabled) return;
    els.host.classList.add('post-mode');
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        els.host.classList.add('drawer-mode');
        if (els.panel) els.panel.open = false;
    } else {
        els.host.classList.add('sidebar-mode');
        if (els.panel) els.panel.open = true;
    }
    const card = els.host.querySelector('.llm-progress-card');
    if (card) card.style.display = 'none';
}

function scheduleLLMOnCalendarRendered(useLLM) {
    const els = scheduleLLMProgressEls();
    if (!els) return;
    if (!useLLM) {
        scheduleLLMProgressSetVisible(false);
        return;
    }
    scheduleLLMResetLayoutMode();
    scheduleLLMHideAiWarningInCalendarArea();
    scheduleLLMShowAiWarningInRecognizedTitle();
}

function scheduleLLMFormatCourseTime(c) {
    const pr = c && (c.periodRange || c.period);
    const wk = c && (c.raw_weeks || c.weeksRaw);
    const parts = [];
    if (pr) parts.push(`${String(pr).replace(/节/g, '')}节`);
    if (wk) parts.push(String(wk));
    return parts.length ? parts.join(' ') : '—';
}

function scheduleLLMProgressAddCourses(courses, source) {
    const els = scheduleLLMProgressEls();
    if (!els || !els.list) return;

    const utils = (typeof window !== 'undefined' && window.ScheduleLLMTimeUtils) ? window.ScheduleLLMTimeUtils : null;
    const slots = (typeof scheduleLLMGetTimeSlotsFromInputs === 'function')
        ? scheduleLLMGetTimeSlotsFromInputs()
        : (Array.isArray(defaultTimeSlots) ? defaultTimeSlots : []);

    const arr = Array.isArray(courses) ? courses : [];
    arr.forEach(c => {
        const name = c && (c.name || c.displayName || c.rawName) ? String(c.name || c.displayName || c.rawName) : '';
        const rawWeeks = c && (c.raw_weeks || c.weeksRaw || c.weeks) ? String(c.raw_weeks || c.weeksRaw || c.weeks) : '';
        const weeks = rawWeeks ? parseWeekString(rawWeeks) : [];
        const prRaw = c && (c.periodRange || c.period) ? String(c.periodRange || c.period) : '';
        const periodRange = prRaw ? scheduleLLMSanitizePeriodRange(prRaw) : '';

        const timeRange = (utils && typeof utils.getTimeRangeForPeriod === 'function')
            ? utils.getTimeRangeForPeriod(slots, periodRange, null)
            : null;

        if (!name || !periodRange || !weeks || weeks.length === 0 || !timeRange) {
            return;
        }

        const time = scheduleLLMFormatCourseTime({ periodRange, raw_weeks: rawWeeks });

        const locSeed = (c && c.building && c.room)
            ? mergeBuildingRoom(c.building, c.room)
            : (c && c.location ? String(c.location) : '');
        const locInfo = standardizeLocation(locSeed);

        const item = {
            name,
            time,
            teacher: c && c.teacher ? String(c.teacher) : '',
            className: c && c.className ? String(c.className) : '',
            location: locInfo.location || (c && c.location ? String(c.location) : ''),
            building: locInfo.building || (c && c.building ? String(c.building) : ''),
            room: locInfo.room || (c && c.room ? String(c.room) : ''),
            raw_weeks: rawWeeks,
            periodRange: periodRange,
            source: source ? String(source) : ''
        };

        const idx = scheduleLLMRecognizedItems.push(item) - 1;
        const li = document.createElement('li');
        li.innerHTML = `<button type="button" class="llm-course-item" data-idx="${idx}"><span class="llm-course-item-name"></span><span class="llm-course-item-time"></span></button>`;
        const btn = li.querySelector('button');
        btn.querySelector('.llm-course-item-name').textContent = name;
        btn.querySelector('.llm-course-item-time').textContent = time;
        els.list.appendChild(li);
    });

    if (els.summary) els.summary.textContent = String(scheduleLLMRecognizedItems.length);
}

function scheduleLLMProgressShowDetail(idx) {
    const els = scheduleLLMProgressEls();
    if (!els || !els.detail) return;
    const item = scheduleLLMRecognizedItems[idx];
    if (!item) return;

    const loc = item.location || ((item.building || item.room) ? `${item.building || ''}${item.room || ''}` : '');

    els.detail.innerHTML = `
        <div class="llm-course-detail-title">${item.name}</div>
        <div class="llm-course-detail-grid">
            <strong>时间</strong><span>${item.time}</span>
            <strong>地点</strong><span>${loc || '—'}</span>
            <strong>教师</strong><span>${item.teacher || '—'}</span>
            <strong>班级</strong><span>${item.className || '—'}</span>
            <strong>来源</strong><span>${item.source || '—'}</span>
        </div>
    `;
    els.detail.style.display = 'block';
}

function scheduleLLMResetLayoutMode() {
    const els = scheduleLLMProgressEls();
    if (!els) return;
    els.host.classList.remove('sidebar-mode', 'drawer-mode', 'post-mode', 'fade-out');
    els.host.style.display = '';
    
    if (els.panel && els.panel.parentElement !== els.host) {
        const card = els.host.querySelector('.llm-progress-card');
        if (card) {
            card.insertAdjacentElement('afterend', els.panel);
        } else {
            els.host.appendChild(els.panel);
        }
        els.panel.classList.remove('moved-below-calendar');
    }

    const card = els.host.querySelector('.llm-progress-card');
    if (card) {
        card.classList.remove('hidden');
        card.style.display = '';
    }
    if (els.panel) els.panel.open = true;
    const label = document.getElementById('llmRecognizedLabel');
    if (label) label.textContent = '已识别课程';
    const main = document.querySelector('.main-content');
    if (main) main.classList.remove('llm-two-col');
}

function scheduleLLMEnterPostMode(enabled) {
    const els = scheduleLLMProgressEls();
    if (!els) return;
    scheduleLLMResetLayoutMode();
    if (!enabled) return;

    els.host.classList.add('post-mode');
    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        els.host.classList.add('drawer-mode');
        const label = document.getElementById('llmRecognizedLabel');
        if (label) label.textContent = '查看课程';
    } else {
        els.host.classList.add('sidebar-mode');
        const label = document.getElementById('llmRecognizedLabel');
        if (label) label.textContent = '课程';
        const main = document.querySelector('.main-content');
        if (main) main.classList.add('llm-two-col');
    }

    if (els.panel) els.panel.open = false;

    const card = els.host.querySelector('.llm-progress-card');
    if (card) {
        card.classList.add('hidden');
        window.setTimeout(() => {
            card.style.display = 'none';
        }, 220);
    }
}

function scheduleLLMOnCalendarRendered(useLLM) {
    const els = scheduleLLMProgressEls();
    if (!els) return;
    if (!useLLM) {
        scheduleLLMProgressSetVisible(false);
        return;
    }
    scheduleLLMResetLayoutMode();

    if (els.panel) {
        els.panel.open = false;
    }

    const shown = scheduleLLMShowAiWarningInRecognizedTitle();
    if (shown) scheduleLLMHideAiWarningInCalendarArea();

    // Fade out progress host
    if (els.host) {
        els.host.classList.add('fade-out');
        setTimeout(() => {
            if (els.host.classList.contains('fade-out')) {
                els.host.style.display = 'none';
            }
        }, 300);
    }

    window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event('resize'));
    });
}

function scheduleLLMHideHintOnGenerate() {
    const el = document.getElementById('llmHint');
    if (!el) return;
    if (el.style.display === 'none') return;
    if (el.classList.contains('llm-hint-fade-out')) return;

    const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
        el.style.display = 'none';
        return;
    }

    el.addEventListener('animationend', () => {
        el.style.display = 'none';
        el.classList.remove('llm-hint-fade-out');
    }, { once: true });

    el.classList.add('llm-hint-fade-out');
}

const SCHEDULELLM_AI_WARNING_TEXT = 'AI识别可能有错误！月历生成后请核对。';

function scheduleLLMClearAiWarningInRecognizedTitle() {
    const label = document.getElementById('llmRecognizedLabel');
    if (!label) return;

    const warn = label.querySelector('.llm-recognized-ai-warning');
    if (warn && warn.parentElement) warn.parentElement.removeChild(warn);
    label.classList.remove('has-ai-warning');
}

function scheduleLLMShowAiWarningInRecognizedTitle() {
    const label = document.getElementById('llmRecognizedLabel');
    if (!label) return false;

    if (label.textContent !== '已识别课程') {
        label.textContent = '已识别课程';
    }

    let warn = label.querySelector('.llm-recognized-ai-warning');
    if (!warn) {
        warn = document.createElement('span');
        warn.className = 'llm-recognized-ai-warning';
        label.appendChild(warn);
    }

    warn.textContent = `(${SCHEDULELLM_AI_WARNING_TEXT})`;
    label.classList.add('has-ai-warning');

    const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
        warn.classList.add('is-visible');
        return true;
    }

    warn.classList.remove('is-visible');
    window.requestAnimationFrame(() => {
        warn.classList.add('is-visible');
    });

    return true;
}

function scheduleLLMHideAiWarningInCalendarArea() {
    const calendarArea = document.getElementById('calendarArea');
    if (!calendarArea) return;

    const banner = calendarArea.querySelector('.schedulellm-calendar-ai-warning');
    if (banner && banner.parentElement) {
        banner.classList.remove('is-visible');
        const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) {
            banner.parentElement.removeChild(banner);
            return;
        }
        window.setTimeout(() => {
            if (banner.parentElement) banner.parentElement.removeChild(banner);
        }, 240);
    }

    const placeholder = calendarArea.querySelector('.placeholder-text');
    if (placeholder) {
        placeholder.classList.remove('placeholder-ai-warning');
        placeholder.classList.remove('placeholder-swap');
    }
}

function scheduleLLMShowAiWarningInCalendarArea() {
    const calendarArea = document.getElementById('calendarArea');
    if (!calendarArea) return;

    const placeholder = calendarArea.querySelector('.placeholder-text');
    if (placeholder) {
        const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduce) {
            placeholder.textContent = SCHEDULELLM_AI_WARNING_TEXT;
            placeholder.classList.add('status-updated');
            placeholder.classList.add('placeholder-ai-warning');
            placeholder.classList.remove('placeholder-uploaded');
            placeholder.classList.remove('placeholder-fade-out');
            return;
        }

        placeholder.classList.add('placeholder-swap');
        placeholder.textContent = SCHEDULELLM_AI_WARNING_TEXT;
        placeholder.classList.add('status-updated');
        placeholder.classList.add('placeholder-ai-warning');
        placeholder.classList.remove('placeholder-uploaded');
        placeholder.classList.remove('placeholder-fade-out');

        window.requestAnimationFrame(() => {
            placeholder.classList.remove('placeholder-swap');
        });
        return;
    }

    let banner = calendarArea.querySelector('.schedulellm-calendar-ai-warning');
    if (!banner) {
        banner = document.createElement('div');
        banner.className = 'schedulellm-calendar-ai-warning no-print';
        banner.setAttribute('role', 'status');
        calendarArea.prepend(banner);
    }

    banner.textContent = SCHEDULELLM_AI_WARNING_TEXT;

    const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
        banner.classList.add('is-visible');
        return;
    }

    banner.classList.remove('is-visible');
    window.requestAnimationFrame(() => {
        banner.classList.add('is-visible');
    });
}

let generatedEvents = [];
let currentCalendarDate = new Date();
let scheduleLLMMinMonth = null;
let scheduleLLMMaxMonth = null;
let scheduleLLMSemesterStartDate = null;
let scheduleLLMCourseRules = [];
let scheduleLLMEditHistory = [];

async function generateSchedule() {
    try {
        console.log("Starting generation...");
        if (rawScheduleData.length === 0) {
            alert("请先上传课表文件");
            return;
        }

        scheduleLLMHideHintOnGenerate();
        scheduleLLMClearAiWarningInRecognizedTitle();
        scheduleLLMShowAiWarningInCalendarArea();

        const btnGen = document.getElementById('btnGenerate');
        const originalBtnText = btnGen.textContent;
        let useLLM = document.getElementById('useLLM').checked; // Changed from const to let
        const llmCache = new Map(); // Cache for unique cell results

        // Regex patterns to identify non-course cells (headers, metadata, etc.)
        // Defined here to be used both for LLM filtering and main loop skipping
        const ignorePatterns = [
            /(星期|周)[\s\n]*[一二三四五六日天]/,
            /^\s*第?\s*[-]*\s*[一二三四五六七八九十\d]+\s*[-~+～至,\s]*\s*[一二三四五六七八九十\d]*\s*节\s*$/,
            /^第\s*[一二三四五六七八九十\d]+$/,
            /^第$/,
            /^节$/,
            /^次$/,
            /学年|学期|课表|教工号|打印时间|注一|内容顺序/,
            /^(上|下|晚|早|午)[\s\n]*(午|晚|晨|间|上)$/,
            /^节次$/
        ];

        if (typeof scheduleLLMResetLayoutMode === 'function') {
            scheduleLLMResetLayoutMode();
        }

        // 未启用 LLM：隐藏右侧进度提示（如果存在）
        if (!useLLM) {
            if (typeof scheduleLLMProgressSetVisible === 'function') {
                scheduleLLMProgressSetVisible(false);
            }
        }

        if (useLLM) {
            const config = {
                baseUrl: document.getElementById('llmBaseUrl').value,
                apiKey: document.getElementById('llmApiKey').value,
                model: document.getElementById('llmModel').value
            };

            const logCtx = {
                baseUrl: config.baseUrl,
                model: config.model,
                ua: (typeof navigator !== 'undefined' ? navigator.userAgent : undefined)
            };

            scheduleLLMLog({ type: 'run_start', ...logCtx, rawRows: rawScheduleData.length });

            const isProxy = /\/api\/llm\/?$/.test((config.baseUrl || '').trim());
            if (!isProxy && !config.apiKey) {
                alert("直连模式需要填写 API Key；生产环境建议使用后端 /api/llm 代理");
                return;
            }

            // Collect all unique non-empty cells
            const uniqueCells = new Set();
            
            rawScheduleData.forEach(row => {
                row.forEach(cell => {
                    if (cell && typeof cell === 'string' && cell.trim()) {
                        const val = canonicalizeLLMCellKey(cell);

                        const m = val.match(/^\s*(?:星期|周)\s*[一二三四五六日天][\s\n]*(.+)$/);
                        if (m && m[1]) {
                            const rest = String(m[1]).trim();
                            if (rest && !ignorePatterns.some(p => p.test(rest))) {
                                uniqueCells.add(rest);
                            }
                        }

                        if (ignorePatterns.some(p => p.test(val))) {
                            return;
                        }
                        uniqueCells.add(val);
                    }
                });
            });

            btnGen.disabled = true;
            btnGen.textContent = "LLM 语义识别中...";

            scheduleLLMProgressSetVisible(true);
            scheduleLLMProgressReset();
            scheduleLLMProgressSetRunning(true);
            scheduleLLMProgressHideError();
            scheduleLLMProgressSetText('准备识别…');

            const cellsToProcess = Array.from(uniqueCells);
            let processedCells = 0;
            let extractedCourses = 0;
            let hadException = false;
            let slowTimer = null;

            scheduleLLMProgressSetProgress(0, cellsToProcess.length, 0);

            const service = window.llmService || (typeof llmService !== 'undefined' ? llmService : null);
            if (!service) {
                console.error("LLM Service not found in window or global scope. Check llm_parser.js loading.");
                scheduleLLMProgressShowError("LLM组件加载失败，已降级使用普通解析");
                alert("LLM组件加载失败，无法使用智能识别功能。将降级使用普通解析。");
                useLLM = false;
                scheduleLLMProgressSetRunning(false);
            } else {
                service.updateConfig(config.baseUrl, config.apiKey, config.model);

                for (let i = 0; i < cellsToProcess.length; i++) {
                    const cell = cellsToProcess[i];
                    const cellTrim = String(cell || '').trim();

                    if (!cellTrim || ignorePatterns.some(p => p.test(cellTrim))) {
                        processedCells++;
                        scheduleLLMProgressSetProgress(processedCells, cellsToProcess.length, extractedCourses);
                        continue;
                    }

                    btnGen.textContent = `识别中 (${i + 1}/${cellsToProcess.length})`;
                    scheduleLLMProgressSetText(`识别中 ${i + 1}/${cellsToProcess.length}`);

                    if (slowTimer) clearTimeout(slowTimer);
                    slowTimer = setTimeout(() => {
                        scheduleLLMProgressSetIcon('warn', '!');
                        scheduleLLMProgressSetText('正在努力识别中...');
                    }, 3000);

                    try {
                        const result = await service.parseCourse(cell);
                        if (slowTimer) {
                            clearTimeout(slowTimer);
                            slowTimer = null;
                        }
                        scheduleLLMProgressSetIcon(null);

                        processedCells++;

                        if (result && !result.error && result.courses && result.courses.length > 0) {
                            llmCache.set(cell, result.courses);
                            extractedCourses += result.courses.length;
                            scheduleLLMProgressAddCourses(result.courses, 'LLM');
                            scheduleLLMLog({
                                type: 'llm_success',
                                ...logCtx,
                                cellHash: scheduleLLMHash(cell),
                                cellLen: String(cell).length,
                                courses: result.courses.length
                            });
                        } else {
                            const reason = result ? (result.error || "Empty courses array") : "Null result";
                            const cleanCell = cell.replace(/\n/g, '\\n');
                            console.warn(`[LLM Failure] Cell: "${cleanCell}" - Reason: ${reason}. System will attempt Regex fallback.`);

                            const regexFallback = parseCourseString(cell);
                            const fbCount = regexFallback && regexFallback.length ? regexFallback.length : 0;
                            extractedCourses += fbCount;
                            if (fbCount > 0) scheduleLLMProgressAddCourses(regexFallback, '正则');

                            scheduleLLMLog({
                                type: 'llm_failure',
                                ...logCtx,
                                reason,
                                cellHash: scheduleLLMHash(cell),
                                cellLen: String(cell).length,
                                llmCourses: (result && result.courses && result.courses.length) ? result.courses.length : 0,
                                regexFallback: fbCount
                            });

                            if (fbCount > 0) {
                                console.info(`[Fallback Success] Regex parser successfully identified ${fbCount} courses from "${cleanCell}".`);
                            } else {
                                console.warn(`[Parsing Warning] Both LLM and Regex failed to extract content from: "${cleanCell}". This may be a header or unrecognized format.`);
                            }
                        }

                        scheduleLLMProgressSetProgress(processedCells, cellsToProcess.length, extractedCourses);

                    } catch (err) {
                        if (slowTimer) {
                            clearTimeout(slowTimer);
                            slowTimer = null;
                        }

                        processedCells++;
                        hadException = true;
                        scheduleLLMProgressSetIcon('err', '!');
                        scheduleLLMProgressShowError((err && err.message) ? `识别出错：${err.message}` : '识别出错');

                        const cleanCell = cell.replace(/\n/g, '\\n');
                        console.error(`[LLM Exception] Error processing cell: "${cleanCell}"`, err);

                        const regexFallback = parseCourseString(cell);
                        const fbCount = regexFallback && regexFallback.length ? regexFallback.length : 0;
                        extractedCourses += fbCount;
                        if (fbCount > 0) scheduleLLMProgressAddCourses(regexFallback, '正则');

                        scheduleLLMLog({
                            type: 'llm_exception',
                            ...logCtx,
                            reason: (err && err.name ? err.name : 'Error') + (err && err.message ? `: ${err.message}` : ''),
                            cellHash: scheduleLLMHash(cell),
                            cellLen: String(cell).length,
                            regexFallback: fbCount
                        });

                        if (fbCount > 0) {
                            console.info(`[Fallback Success] Regex parser successfully identified ${fbCount} courses from "${cleanCell}".`);
                        } else {
                            console.warn(`[Parsing Warning] Regex fallback also returned no results for: "${cleanCell}".`);
                        }

                        scheduleLLMProgressSetProgress(processedCells, cellsToProcess.length, extractedCourses);
                    }
                }

                scheduleLLMProgressSetRunning(false);
                if (!hadException) {
                    const els = scheduleLLMProgressEls();
                    if (els) els.host.classList.toggle('done', true);
                    scheduleLLMProgressSetIcon('done', '✓');
                    scheduleLLMProgressHideError();
                    scheduleLLMProgressSetText('识别完成');
                } else {
                    scheduleLLMProgressSetText('识别完成（存在错误，可重试）');
                }
            }

            btnGen.textContent = originalBtnText;
            btnGen.disabled = false;
        }

        const startDateInput = document.getElementById('semesterStart').value;
        if (!startDateInput) return;
        const semesterStart = new Date(startDateInput);
        scheduleLLMSemesterStartDate = new Date(semesterStart.getTime());

        // Find Header Row
        let headerRowIdx = -1;
        for (let r = 0; r < rawScheduleData.length; r++) {
            const row = rawScheduleData[r];
            const dayCount = (row || []).reduce((n, c) => {
                if (!c || typeof c !== 'string') return n;
                return /(星期|周)\s*[一二三四五六日天]/.test(c) ? (n + 1) : n;
            }, 0);
            if (dayCount >= 3) {
                headerRowIdx = r;
                break;
            }
        }

        if (headerRowIdx === -1) {
            alert("未识别到'星期一'或'周一'表头，请检查文件格式");
            return;
        }

        const headerRow = rawScheduleData[headerRowIdx];
        const headerEmbeddedCourses = {};
        headerRow.forEach((cell, idx) => {
            if (!cell || typeof cell !== 'string') return;
            const s0 = String(cell);
            const m = s0.match(/^\s*((?:星期|周)\s*[一二三四五六日天])[\s\n]+([\s\S]+)$/);
            if (!m) return;
            const day = String(m[1]).replace(/\s+/g, '');
            const rest = String(m[2] || '').trim();
            headerRow[idx] = day;
            if (rest) headerEmbeddedCourses[idx] = rest;
        });

        let colToDayIdx = {}; // col -> 1(Mon)..7(Sun)
        headerRow.forEach((cell, idx) => {
            if (!cell || typeof cell !== 'string') return;
            if (/(星期|周)一/.test(cell)) colToDayIdx[idx] = 1;
            if (/(星期|周)二/.test(cell)) colToDayIdx[idx] = 2;
            if (/(星期|周)三/.test(cell)) colToDayIdx[idx] = 3;
            if (/(星期|周)四/.test(cell)) colToDayIdx[idx] = 4;
            if (/(星期|周)五/.test(cell)) colToDayIdx[idx] = 5;
            if (/(星期|周)六/.test(cell)) colToDayIdx[idx] = 6;
            if (/(星期|周)(日|天)/.test(cell)) colToDayIdx[idx] = 7;
        });

        // Iterate rows below header
        const events = [];
        const weeklessBuffer = []; // Buffer for courses without specific weeks

        // Read current time settings from UI
        // Fix: Removed unused timeInputs variable
        const currentSlots = [];
        for (let i = 0; i < defaultTimeSlots.length; i++) {
            const startInput = document.querySelector(`input[data-idx="${i}"][data-type="start"]`);
            const endInput = document.querySelector(`input[data-idx="${i}"][data-type="end"]`);
            if (startInput && endInput) {
                currentSlots.push({ start: startInput.value, end: endInput.value });
            } else {
                currentSlots.push(defaultTimeSlots[i]);
            }
        }

        const rowsToIterate = [];
        const embeddedKeys = Object.keys(headerEmbeddedCourses);
        if (embeddedKeys.length > 0) {
            const syntheticRow = new Array(headerRow.length).fill('');
            syntheticRow[1] = headerRow[1];
            for (const k of embeddedKeys) {
                syntheticRow[Number(k)] = headerEmbeddedCourses[k];
            }
            rowsToIterate.push(syntheticRow);
        }
        for (let r = headerRowIdx + 1; r < rawScheduleData.length; r++) {
            const row = rawScheduleData[r];
            if (!row || row.length === 0) continue;
            rowsToIterate.push(row);
        }

        const dayCols = Object.keys(colToDayIdx).map(n => parseInt(n, 10)).filter(Number.isFinite).sort((a, b) => a - b);
        if (dayCols.length > 0) {
            const sampleRows = [];
            for (let r = headerRowIdx + 1; r < rawScheduleData.length && sampleRows.length < 8; r++) {
                const row = rawScheduleData[r];
                if (!row || row.length === 0) continue;
                sampleRows.push(row);
            }

            const stripPeriodPrefixLine = (s0) => {
                const s = String(s0 || '');
                return s.replace(/^\s*第?\s*(?:[一二三四五六七八九十\d]{1,3})\s*(?:-\s*(?:[一二三四五六七八九十\d]{1,3}))?\s*节\s*(?:[\r\n]+|$)/, '');
            };

            const isPeriodish = (s0) => {
                const raw = String(s0 || '');
                const trimmed = raw.trim();
                if (!trimmed) return false;

                const s = trimmed.replace(/[~～—–−]/g, '-');
                const flat = s.replace(/\s+/g, ' ');

                const lines = s.split(/\n+/).map(x => x.trim()).filter(Boolean);
                const first = lines[0] || flat;

                const timeRangeRe = /(?:^|\s)\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}(?:\s|$)/;
                if (timeRangeRe.test(flat)) {
                    if (/^(?:节次|节)$/.test(first)) return true;
                    if (/^(?:上|下|晚|早|午)\s*(?:午|晚|晨|间|上)?$/.test(first)) return true;
                    if (/^第?\s*[一二三四五六七八九十\d]{1,3}\s*(?:-\s*[一二三四五六七八九十\d]{1,3})?\s*节?$/.test(first)) return true;
                    if (/^\d{1,2}\s*(?:-\s*\d{1,2})?\s*节?$/.test(first)) return true;
                    if (/^\d{1,2}$/.test(first)) return true;
                }

                if (/^(?:节次|节)$/.test(flat)) return true;
                if (/^(?:上|下|晚|早|午)\s*(?:午|晚|晨|间|上)?$/.test(flat)) return true;
                if (/^第?\s*[一二三四五六七八九十\d]{1,3}\s*(?:-\s*[一二三四五六七八九十\d]{1,3})?\s*节?$/.test(first)) return true;
                if (/^\d+\s*(?:-\s*\d+)?\s*节?$/.test(first)) return true;
                return false;
            };

            const periodLikeCountAt = (col) => {
                let n = 0;
                for (const row of sampleRows) {
                    const s0 = String((row && row[col] != null) ? row[col] : '').trim();
                    if (!s0) continue;
                    if (isPeriodish(s0)) n++;
                }
                return n;
            };

            const courseLikeCountAt = (col) => {
                let n = 0;
                for (const row of sampleRows) {
                    const s0 = String((row && row[col] != null) ? row[col] : '').trim();
                    if (!s0) continue;
                    if (isPeriodish(s0)) continue;
                    const s = stripPeriodPrefixLine(s0).trim();
                    if (!s) continue;
                    const hasLines = /\n/.test(s0) && s0.split(/\n+/).filter(Boolean).length >= 2;
                    const hasWeeks = /(\d+\s*[-~～—–−]\s*\d+|\d+)\s*周/.test(s0) || /周\s*\(/.test(s0);
                    const hasPlace = /(教|楼|室|馆|中心)/.test(s0) || /[A-Za-z]\s*\d{2,}/.test(s0) || /\d{3,}/.test(s0);
                    if (hasLines || hasWeeks || hasPlace) n++;
                }
                return n;
            };

            const candidateShifts = [-2, -1, 0, 1, 2];
            const baseCols = dayCols.slice();
            let bestShift = 0;
            let bestScore = -Infinity;
            let baseScore = -Infinity;

            for (const sh of candidateShifts) {
                let good = 0;
                let bad = 0;
                let oob = 0;
                for (const col of baseCols) {
                    const cc = col + sh;
                    if (cc < 0) {
                        oob++;
                        continue;
                    }
                    good += courseLikeCountAt(cc);
                    bad += periodLikeCountAt(cc);
                }
                const score = good * 2 - bad * 3 - oob * 8 - Math.abs(sh) * 0.2;
                if (sh === 0) baseScore = score;
                if (score > bestScore + 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && Math.abs(sh) < Math.abs(bestShift))) {
                    bestScore = score;
                    bestShift = sh;
                }
            }

            const improve = bestScore - baseScore;
            if (bestShift !== 0 && improve >= 4) {
                const adjusted = {};
                Object.entries(colToDayIdx).forEach(([k, v]) => {
                    const nk = parseInt(k, 10);
                    if (!Number.isFinite(nk)) return;
                    adjusted[nk + bestShift] = v;
                });
                colToDayIdx = adjusted;
                console.warn('[Day Map Shift]', { shift: bestShift, improve, before: baseCols, after: Object.keys(colToDayIdx).map(n => parseInt(n, 10)).filter(Number.isFinite).sort((a, b) => a - b) });
            }
        }

        console.log("Day Map:", colToDayIdx);

        const parsePeriodCellInfo = (cell) => {
            if (!cell) return null;
            const s0 = String(cell).trim();
            if (!s0) return null;

            const toP = (n) => {
                const v = parseInt(n, 10);
                if (!Number.isFinite(v)) return null;
                return v >= 1 ? v : 1;
            };

            const s = s0.replace(/[~～—–−]/g, '-');

            const rangeMatch = s.match(/第?\s*(\d+)\s*-\s*(\d+)\s*节?/);
            if (rangeMatch) {
                const a0 = toP(rangeMatch[1]);
                const b0 = toP(rangeMatch[2]);
                if (a0 === null || b0 === null) return null;
                return { start: a0, end: b0 >= a0 ? b0 : a0 };
            }

            const explicitMatch = s.match(/第?\s*(\d+)\s*节/);
            if (explicitMatch) {
                const v = toP(explicitMatch[1]);
                if (v === null) return null;
                return { start: v, end: v };
            }

            const digitMatch = s.match(/^(\d+)/);
            if (digitMatch) {
                const v = toP(digitMatch[1]);
                if (v === null) return null;
                return { start: v, end: v };
            }

            const cnNums = {
                '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
                '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
                '十一': 11, '十二': 12
            };
            for (const [k, v] of Object.entries(cnNums)) {
                if (s.includes(k)) return { start: v, end: v };
            }

            return null;
        };

        for (const row of rowsToIterate) {
            if (!row || row.length === 0) continue;

            let periodNum = -1;

            let periodInfo = null;
            for (let c = 0; c < Math.min(row.length, 3); c++) {
                const info = parsePeriodCellInfo(row[c]);
                if (info) {
                    periodInfo = info;
                    break;
                }
            }

            if (!periodInfo || !Number.isFinite(periodInfo.start) || periodInfo.start > 12) {
                continue;
            }

            periodNum = periodInfo.start;
            const periodEnd = Number.isFinite(periodInfo.end) ? periodInfo.end : periodNum;
            const rowPeriodRange = periodEnd !== periodNum ? `${periodNum}-${periodEnd}` : String(periodNum);

            const timeSlotStart = currentSlots[periodNum - 1];
            const timeSlotEnd = currentSlots[periodEnd - 1] || timeSlotStart;
            if (!timeSlotStart || !timeSlotEnd) continue;

            // Iterate Columns
            for (const [colIdx0, dayIdx0] of Object.entries(colToDayIdx)) {
                const colIdx = parseInt(colIdx0, 10);
                const dayIdx = parseInt(dayIdx0, 10);
                if (!Number.isFinite(colIdx) || !Number.isFinite(dayIdx)) continue;

                const rawCell = (row && row[colIdx] != null) ? row[colIdx] : '';
                if (rawCell == null) continue;

                let cellContent = (typeof rawCell === 'string') ? rawCell : String(rawCell);
                if (!cellContent || !cellContent.trim()) continue;

                const stripped = cellContent.replace(/^\s*第?\s*(?:[一二三四五六七八九十\d]{1,3})\s*(?:-\s*(?:[一二三四五六七八九十\d]{1,3}))?\s*节\s*(?:[\r\n]+|$)/, '');
                if (stripped && stripped.trim() && stripped.trim() !== cellContent.trim()) {
                    cellContent = stripped;
                }

                // Skip if matches any ignore pattern (Headers, Time slots, etc.)
                if (ignorePatterns.some(p => p.test(cellContent.trim()))) {
                    continue;
                }

                // 1. Parse Courses from Cell
                let courses = [];
                
                const cacheKey = canonicalizeLLMCellKey(cellContent);

                if (useLLM && llmCache.has(cacheKey)) {
                    const cachedCourses = llmCache.get(cacheKey);
                    // Re-hydrate objects (ensure structure)
                    courses = cachedCourses.map(c => {
                        const locSeed = (c && c.building && c.room) ? mergeBuildingRoom(c.building, c.room) : (c && c.location ? String(c.location) : "");
                        const locInfo = standardizeLocation(locSeed);

                        if (typeof window !== 'undefined' && window.__SCHEDULELLM_DEBUG_PARSE && /([A-Za-z])\1\d/.test(locInfo.room || "")) {
                            console.warn("[LocationDupLetter]", { locSeed, locInfo, llm: c });
                        }

                        return {
                            rawName: c.name,
                            displayName: simplifyName(c.name),
                            weeks: Array.isArray(c.weeks) ? c.weeks : parseWeekString(c.raw_weeks || c.weeks),
                            location: locInfo.location || "待通知",
                            className: c.className ? c.className.replace(/^[\(（]/, '').replace(/[\)）]$/, '') : "",
                            periodRange: scheduleLLMSanitizePeriodRange(c.periodRange || ""),
                            rawStr: cellContent,
                            building: locInfo.building,
                            room: locInfo.room
                        };
                    });
                } else {
                    courses = parseCourseString(cellContent);
                }

                // 2. Generate Events
                courses.forEach(course => {
                    // [DEBUG] Logging for Week Extraction Diagnosis
                    // Logs detailed info for all courses, with specific focus on Higher Math as requested
                    const debugDayName = ['?', '一', '二', '三', '四', '五', '六', '日'][dayIdx] || dayIdx;
                    const isTarget = course.displayName.includes("高等数学");
                    // Use a distinctive prefix for easy filtering
                    const logPrefix = isTarget ? "[DEBUG-TARGET]" : "[DEBUG]"; 
                    
                    console.log(`${logPrefix}周次识别结果：
  课程: ${course.displayName}
  时间: 周${debugDayName} (DayIdx: ${dayIdx})
  原始文本: "${(course.rawStr || cellContent || "").replace(/\n/g, '\\n')}"
  识别周次: [${course.weeks.join(', ')}]
  识别班级: ${course.className || "无"}
  识别地点: ${course.location || "无"}
  来源: ${useLLM && llmCache.has(cacheKey) ? "LLM缓存" : "正则解析"}`);

                    const courseWeeks = course.weeks;
                    
                    if (courseWeeks.length === 0) {
                         // No weeks? Buffer it? 
                         // Or just add to "All Semester" (bad idea).
                         // Let's warn and skip for now, or add to a "Fix Me" list.
                         // But for simplicity, we skip generation but maybe show error.
                         return;
                    }

                    courseWeeks.forEach(weekNum => {
                        // Calculate Date
                        // Date = StartDate + (Week-1)*7 days + (DayIdx-1) days
                        const daysToAdd = (weekNum - 1) * 7 + (dayIdx - 1);
                        const targetDate = new Date(semesterStart);
                        targetDate.setDate(semesterStart.getDate() + daysToAdd);

                        // Determine Time of Day for Color Coding
                        // Period 1-4: Morning
                        // Period 5-8: Afternoon
                        // Period 9+: Evening
                        let timeOfDay = 'morning';
                        if (periodNum >= 5 && periodNum <= 8) timeOfDay = 'afternoon';
                        if (periodNum >= 9) timeOfDay = 'evening';

                        const eventPeriodRange = course.periodRange ? String(course.periodRange) : rowPeriodRange;

                        events.push({
                            title: course.displayName,
                            rawTitle: course.rawName,
                            location: course.location,
                            className: course.className,
                            weeks: course.weeks, // Pass all weeks
                            periodRange: eventPeriodRange, // Pass period info
                            startTime: timeSlotStart.start, // HH:mm
                            endTime: timeSlotEnd.end,
                            date: targetDate, // Date Object
                            week: weekNum,
                            period: periodNum,
                            dayOfWeek: dayIdx,
                            timeOfDay: timeOfDay,
                            description: `课程: ${course.rawName}\n地点: ${course.location}\n周次: ${weekNum}周\n班级: ${course.className}`
                        });
                    });
                });
            }
        }

        generatedEvents = events;
        scheduleLLMCourseRules = (typeof scheduleLLMBuildCourseRulesFromEvents === 'function')
            ? scheduleLLMBuildCourseRulesFromEvents(events)
            : [];
        scheduleLLMEditHistory = [];
        console.log("Events generated:", events.length);

        if (events.length === 0) {
            // Diagnostic Alert
            let msg = "未生成任何日程。\n诊断信息：\n";
            msg += `1. 读取总行数: ${rawScheduleData.length}\n`;
            msg += `2. 表头行索引: ${headerRowIdx} (列数: ${Object.keys(colToDayIdx).length})\n`;
            const effectiveCourseRowCount = Math.max(0, rawScheduleData.length - headerRowIdx - 1);
            msg += `3. 有效课程行数(估算): ${effectiveCourseRowCount}\n`;
            msg += "可能原因：\n- 无法识别节次列（请确保第一列或前几列包含'1','2','一','二'等数字）\n- 课程单元格为空或无法解析\n- 课程周次格式不标准";
            alert(msg);
        }

        renderCalendar(events);

        if (events.length > 0) {
            scheduleLLMHideAiWarningInCalendarArea();
            scheduleLLMShowAiWarningInRecognizedTitle();
        }

        if (typeof scheduleLLMOnCalendarRendered === 'function') {
            scheduleLLMOnCalendarRendered(useLLM && events.length > 0);
        }
        
        // Restore button state (It was modified at start of generateSchedule)
        // btnGen is already defined in the outer scope of generateSchedule, reuse it.
        btnGen.textContent = "生成月历";
        btnGen.disabled = false;

    } catch (e) {
        console.error(e);
        alert("生成月历出错: " + e.message);
        
        // Restore button state on error too
        const btnGenRetry = document.getElementById('btnGenerate'); // Use different name if strictly needed, but reusing outer var is better if scope allows. 
        // Actually, btnGen is defined at top of function. We can just use it if we are in same scope.
        // But 'catch' block has its own scope? No, 'btnGen' from top of function is accessible in catch.
        // BUT, the previous code re-declared it with 'const btnGen = ...' inside the try block or if block?
        // Let's check where it was defined.
        // It was defined at: const btnGen = document.getElementById('btnGenerate'); at line 418 (approx).
        
        // So we should NOT redeclare it.
        if (typeof btnGen !== 'undefined') {
            btnGen.textContent = "生成月历";
            btnGen.disabled = false;
        } else {
             document.getElementById('btnGenerate').textContent = "生成月历";
             document.getElementById('btnGenerate').disabled = false;
        }
    }
}

function scheduleLLMNewId() {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function scheduleLLMDeepCloneRules(rules) {
    try {
        return JSON.parse(JSON.stringify(Array.isArray(rules) ? rules : []));
    } catch (_) {
        const arr = Array.isArray(rules) ? rules : [];
        return arr.map(r => ({ ...r, weeks: Array.isArray(r.weeks) ? r.weeks.slice() : [] }));
    }
}

function scheduleLLMGetSemesterStartDate() {
    if (scheduleLLMSemesterStartDate instanceof Date && Number.isFinite(scheduleLLMSemesterStartDate.getTime())) {
        return new Date(scheduleLLMSemesterStartDate.getTime());
    }

    const input = document.getElementById('semesterStart');
    const v = input && input.value ? String(input.value) : '';
    if (!v) return null;

    const d = new Date(v);
    if (!Number.isFinite(d.getTime())) return null;

    scheduleLLMSemesterStartDate = new Date(d.getTime());
    return new Date(d.getTime());
}

function scheduleLLMBuildCourseRulesFromEvents(events) {
    const utils = (typeof window !== 'undefined' && window.ScheduleLLMTimeUtils) ? window.ScheduleLLMTimeUtils : null;
    const map = new Map();
    const arr = Array.isArray(events) ? events : [];

    arr.forEach(ev => {
        if (!ev) return;

        const title = ev.title ? String(ev.title) : '';
        if (!title) return;

        const rawTitle = ev.rawTitle ? String(ev.rawTitle) : '';
        const location = ev.location ? String(ev.location) : '';
        const className = ev.className ? String(ev.className) : '';
        const dayOfWeek = Number.isFinite(ev.dayOfWeek)
            ? ev.dayOfWeek
            : (ev.date ? ((ev.date.getDay() === 0) ? 7 : ev.date.getDay()) : null);
        if (!Number.isFinite(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) return;

        const pr = scheduleLLMSanitizePeriodRange(ev.periodRange ? String(ev.periodRange) : (ev.period != null ? String(ev.period) : ''));
        if (!pr) return;

        const weekNum = Number.isFinite(ev.week) ? ev.week : null;
        if (!Number.isFinite(weekNum) || weekNum <= 0) return;

        const key = [title, rawTitle, location, className, String(dayOfWeek), pr].join('||');
        if (!map.has(key)) {
            map.set(key, {
                id: scheduleLLMNewId(),
                name: title,
                rawName: rawTitle,
                location,
                className,
                dayOfWeek,
                periodRange: pr,
                weeks: new Set()
            });
        }
        map.get(key).weeks.add(weekNum);
    });

    const rules = Array.from(map.values()).map(r => {
        const weeks = Array.from(r.weeks).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
        const weeksRaw = (utils && typeof utils.formatWeekRanges === 'function')
            ? utils.formatWeekRanges(weeks)
            : (weeks.length ? `第${weeks[0]}-${weeks[weeks.length - 1]}周` : '');
        return {
            id: r.id,
            name: r.name,
            rawName: r.rawName,
            location: r.location,
            className: r.className,
            dayOfWeek: r.dayOfWeek,
            periodRange: r.periodRange,
            weeksRaw,
            weeks,
            source: 'auto',
            createdAt: 0
        };
    });

    rules.sort((a, b) => {
        const dn = (a.dayOfWeek || 0) - (b.dayOfWeek || 0);
        if (dn) return dn;
        const pn = String(a.periodRange || '').localeCompare(String(b.periodRange || ''), 'zh');
        if (pn) return pn;
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
    });

    return rules;
}

function scheduleLLMCurrentTimeSlots() {
    return (typeof scheduleLLMGetTimeSlotsFromInputs === 'function')
        ? scheduleLLMGetTimeSlotsFromInputs()
        : (Array.isArray(defaultTimeSlots) ? defaultTimeSlots : []);
}

function scheduleLLMParseWeeksForEditor(weeksRaw) {
    const raw = String(weeksRaw || '').trim();
    if (!raw) return [];

    const parseNumList = (s, maxWeek) => {
        if (!s) return [];
        const set = new Set();
        s.split(/[,，]/).forEach(part => {
            const p = String(part || '').trim();
            if (!p) return;
            const mRange = p.match(/^(\d+)\s*-\s*(\d+)$/);
            if (mRange) {
                let a = parseInt(mRange[1], 10);
                let b = parseInt(mRange[2], 10);
                if (!Number.isFinite(a) || !Number.isFinite(b)) return;
                if (a <= 0 || a > maxWeek || b <= 0 || b > maxWeek) return;
                if (b < a) b = a;
                for (let i = a; i <= b; i++) set.add(i);
                return;
            }
            if (/^\d+$/.test(p)) {
                const n = parseInt(p, 10);
                if (Number.isFinite(n) && n > 0 && n <= maxWeek) set.add(n);
            }
        });
        return Array.from(set).sort((a, b) => a - b);
    };

    const maxWeek = 50;

    const parsed = parseWeekString(raw);
    if (parsed && parsed.length > 0) {
        const hasComma = /[,，]/.test(raw);
        const weekMarkCount = (raw.match(/[周Ww]/g) || []).length;

        if (hasComma && weekMarkCount === 1) {
            const stripped = raw.replace(/^\s*第\s*/g, '').replace(/\s*周\s*$/g, '');
            if (stripped && stripped !== raw && /[,，]/.test(stripped) && /^[\d\s,，\-]+$/.test(stripped)) {
                const alt = parseNumList(stripped, maxWeek);
                if (alt.length > parsed.length) return alt;
            }
        }

        return parsed;
    }

    const stripped = raw.replace(/^\s*第\s*/g, '').replace(/\s*周\s*$/g, '');
    if (stripped && stripped !== raw) {
        if (/^\s*\d+\s*(?:[,，]\s*\d+\s*)+$/.test(stripped)) {
            const nums = stripped
                .split(/[,，]/)
                .map(x => parseInt(String(x).trim(), 10))
                .filter(n => Number.isFinite(n) && n > 0 && n <= maxWeek);
            return Array.from(new Set(nums)).sort((a, b) => a - b);
        }
        if (/[,，]/.test(stripped) && /^[\d\s,，\-]+$/.test(stripped)) {
            return parseNumList(stripped, maxWeek);
        }
    }

    if (/^\s*\d+\s*(?:[,，]\s*\d+\s*)+$/.test(raw)) {
        const nums = raw
            .split(/[,，]/)
            .map(x => parseInt(String(x).trim(), 10))
            .filter(n => Number.isFinite(n) && n > 0 && n <= maxWeek);
        return Array.from(new Set(nums)).sort((a, b) => a - b);
    }

    if (/[,，]/.test(raw) && /^[\d\s,，\-]+$/.test(raw)) {
        return parseNumList(raw, maxWeek);
    }

    return [];
}

function scheduleLLMNormalizeCourseRuleInput(input) {
    const utils = (typeof window !== 'undefined' && window.ScheduleLLMTimeUtils) ? window.ScheduleLLMTimeUtils : null;
    const raw = input && typeof input === 'object' ? input : {};

    const name = raw.name ? String(raw.name).trim() : '';
    if (!name) return { ok: false, message: '课程名称不能为空' };

    const dayOfWeek = parseInt(raw.dayOfWeek, 10);
    if (!Number.isFinite(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 7) return { ok: false, message: '星期信息无效' };

    const periodSeed = (raw.periodRange != null && String(raw.periodRange).trim())
        ? String(raw.periodRange)
        : (raw.period != null ? String(raw.period) : '');
    const periodRange = scheduleLLMSanitizePeriodRange(periodSeed);
    if (!periodRange) return { ok: false, message: '节次不能为空' };

    const weeksRawInput = raw.weeksRaw ? String(raw.weeksRaw).trim() : '';
    const weeksFromRaw = weeksRawInput ? scheduleLLMParseWeeksForEditor(weeksRawInput) : [];

    const weeksFromArr = Array.isArray(raw.weeks)
        ? raw.weeks
            .map(n => parseInt(String(n).trim(), 10))
            .filter(n => Number.isFinite(n) && n > 0 && n <= 50)
        : [];

    const weeksArrDedup = Array.from(new Set(weeksFromArr)).sort((a, b) => a - b);

    const weeks = (weeksArrDedup.length > 0 && weeksArrDedup.length > (weeksFromRaw ? weeksFromRaw.length : 0))
        ? weeksArrDedup
        : (weeksFromRaw && weeksFromRaw.length > 0 ? weeksFromRaw : weeksArrDedup);

    if (!weeks || weeks.length === 0) return { ok: false, message: '周次不能为空或格式不正确' };

    const weeksRaw = weeksRawInput || ((utils && typeof utils.formatWeekRanges === 'function') ? utils.formatWeekRanges(weeks) : formatWeekRanges(weeks));

    const slots = scheduleLLMCurrentTimeSlots();
    const timeRange = (utils && typeof utils.getTimeRangeForPeriod === 'function')
        ? utils.getTimeRangeForPeriod(slots, periodRange, null)
        : null;
    if (!timeRange) return { ok: false, message: '节次时间无效，请检查节次时间设置' };

    return {
        ok: true,
        rule: {
            id: raw.id ? String(raw.id) : scheduleLLMNewId(),
            name,
            rawName: raw.rawName ? String(raw.rawName) : name,
            location: raw.location ? String(raw.location).trim() : '',
            className: raw.className ? String(raw.className).trim() : '',
            dayOfWeek,
            periodRange,
            weeksRaw,
            weeks,
            source: raw.source ? String(raw.source) : 'auto',
            createdAt: Number.isFinite(Number(raw.createdAt)) ? Number(raw.createdAt) : (raw.source === 'manual' ? Date.now() : 0)
        }
    };
}

function scheduleLLMValidateCourseRules(rules) {
    const utils = (typeof window !== 'undefined' && window.ScheduleLLMTimeUtils) ? window.ScheduleLLMTimeUtils : null;
    if (!utils || typeof utils.getTimeRangeForPeriod !== 'function' || typeof utils.parseTimeToMinutes !== 'function') {
        return { ok: true };
    }

    const slots = scheduleLLMCurrentTimeSlots();
    const arr = Array.isArray(rules) ? rules : [];

    const bySlot = new Map();
    for (const r of arr) {
        const norm = scheduleLLMNormalizeCourseRuleInput(r);
        if (!norm.ok) return { ok: false, message: norm.message };

        const rule = norm.rule;
        const tr = utils.getTimeRangeForPeriod(slots, rule.periodRange, null);
        if (!tr) return { ok: false, message: `课程“${rule.name}”节次时间无效` };

        const sMin = utils.parseTimeToMinutes(tr.startTime);
        const eMin = utils.parseTimeToMinutes(tr.endTime);
        if (sMin == null || eMin == null || eMin <= sMin) return { ok: false, message: `课程“${rule.name}”时间无效` };

        const loc = standardizeLocation(rule.location).location;

        for (const wk of rule.weeks) {
            const key = `${wk}-${rule.dayOfWeek}`;
            if (!bySlot.has(key)) bySlot.set(key, []);
            bySlot.get(key).push({
                name: rule.name,
                startMin: sMin,
                endMin: eMin,
                week: wk,
                day: rule.dayOfWeek,
                location: loc,
                startPeriod: tr.startPeriod,
                endPeriod: tr.endPeriod
            });
        }
    }

    const warnings = [];

    for (const [key, list] of bySlot.entries()) {
        const items = list.slice().sort((a, b) => a.startMin - b.startMin);
        for (let i = 1; i < items.length; i++) {
            const prev = items[i - 1];
            const cur = items[i];
            if (cur.startMin < prev.endMin) {
                const parts = key.split('-');
                const wk = parts[0];
                const day = parseInt(parts[1], 10);
                const dayLabel = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][day] || '';

                const sameTime = cur.startMin === prev.startMin && cur.endMin === prev.endMin;
                const sameLoc = String(cur.location || '') === String(prev.location || '');
                const samePeriod = (cur.startPeriod === prev.startPeriod) && (cur.endPeriod === prev.endPeriod);

                if (sameTime && sameLoc && samePeriod) {
                    warnings.push({ week: wk, day, dayLabel, a: prev.name, b: cur.name, location: cur.location });
                    continue;
                }

                return { ok: false, message: `存在时间冲突：第${wk}周${dayLabel}“${prev.name}”与“${cur.name}”时间重叠` };
            }
        }
    }

    return warnings.length > 0 ? { ok: true, warnings } : { ok: true };
}

function scheduleLLMGenerateEventsFromCourseRules(rules) {
    const utils = (typeof window !== 'undefined' && window.ScheduleLLMTimeUtils) ? window.ScheduleLLMTimeUtils : null;
    const semesterStart = scheduleLLMGetSemesterStartDate();
    if (!semesterStart) return [];

    const slots = scheduleLLMCurrentTimeSlots();
    const out = [];
    const arr = Array.isArray(rules) ? rules : [];

    for (const r0 of arr) {
        const norm = scheduleLLMNormalizeCourseRuleInput(r0);
        if (!norm.ok) continue;
        const r = norm.rule;

        const tr = (utils && typeof utils.getTimeRangeForPeriod === 'function')
            ? utils.getTimeRangeForPeriod(slots, r.periodRange, null)
            : null;
        if (!tr) continue;

        const periodNum = tr.startPeriod;
        let timeOfDay = 'morning';
        if (periodNum >= 5 && periodNum <= 8) timeOfDay = 'afternoon';
        if (periodNum >= 9) timeOfDay = 'evening';

        for (const weekNum of r.weeks) {
            const daysToAdd = (weekNum - 1) * 7 + (r.dayOfWeek - 1);
            const targetDate = new Date(semesterStart);
            targetDate.setDate(semesterStart.getDate() + daysToAdd);

            out.push({
                title: r.name,
                rawTitle: r.rawName,
                location: r.location || '—',
                className: r.className || '',
                weeks: r.weeks,
                periodRange: r.periodRange,
                startTime: tr.startTime,
                endTime: tr.endTime,
                date: targetDate,
                week: weekNum,
                period: periodNum,
                dayOfWeek: r.dayOfWeek,
                timeOfDay: timeOfDay,
                description: `课程: ${r.rawName || r.name}\n地点: ${r.location || '—'}\n周次: ${weekNum}周\n班级: ${r.className || ''}`
            });
        }
    }

    out.sort((a, b) => {
        const ta = a.date.getTime();
        const tb = b.date.getTime();
        if (ta !== tb) return ta - tb;
        if ((a.period || 0) !== (b.period || 0)) return (a.period || 0) - (b.period || 0);
        return String(a.title || '').localeCompare(String(b.title || ''), 'zh');
    });

    return out;
}

function scheduleLLMRenderFromCurrentEvents() {
    scheduleLLMSetCourseListVisible(Array.isArray(generatedEvents) && generatedEvents.length > 0);
    scheduleLLMSetMonthRangeFromEvents(generatedEvents);
    const base = currentCalendarDate instanceof Date && Number.isFinite(currentCalendarDate.getTime())
        ? currentCalendarDate
        : new Date();
    const target = scheduleLLMClampMonthToRange(base);
    scheduleLLMRenderMonth(target, 0);
}

function scheduleLLMSetCourseRules(nextRules, action) {
    const before = scheduleLLMDeepCloneRules(scheduleLLMCourseRules);
    scheduleLLMCourseRules = Array.isArray(nextRules) ? nextRules : [];
    scheduleLLMEditHistory = Array.isArray(scheduleLLMEditHistory) ? scheduleLLMEditHistory : [];
    scheduleLLMEditHistory.push({
        ts: new Date().toISOString(),
        action: action ? String(action) : '修改',
        before
    });
    if (scheduleLLMEditHistory.length > 120) {
        scheduleLLMEditHistory.splice(0, scheduleLLMEditHistory.length - 120);
    }

    generatedEvents = scheduleLLMGenerateEventsFromCourseRules(scheduleLLMCourseRules);
    scheduleLLMRenderFromCurrentEvents();
}

function scheduleLLMUndoLastEdit() {
    if (!Array.isArray(scheduleLLMEditHistory) || scheduleLLMEditHistory.length === 0) return false;
    const last = scheduleLLMEditHistory.pop();
    scheduleLLMCourseRules = Array.isArray(last && last.before) ? last.before : [];
    generatedEvents = scheduleLLMGenerateEventsFromCourseRules(scheduleLLMCourseRules);
    scheduleLLMRenderFromCurrentEvents();
    return true;
}

function scheduleLLMRenderCourseEditor(bodyEl) {
    if (!bodyEl) return;
    const root = bodyEl.querySelector('.course-editor');
    if (!root) return;

    const listEl = root.querySelector('[data-role="list"]');
    const histEl = root.querySelector('[data-role="history"]');

    const dayLabel = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'];

    const buildLabeledInput = (labelText, inputEl) => {
        const label = document.createElement('label');
        label.textContent = labelText;
        return { label, inputEl };
    };

    const createRuleCard = (rule) => {
        const card = document.createElement('div');
        card.className = 'course-editor-row';
        card.dataset.id = rule.id;

        const head = document.createElement('div');
        head.className = 'course-editor-row-head';

        const title = document.createElement('div');
        title.className = 'course-editor-row-title';
        title.textContent = rule.name || '未命名课程';
        if (rule && String(rule.source || '') === 'manual') {
            const tag = document.createElement('span');
            tag.className = 'course-editor-manual-tag';
            tag.textContent = '（手动添加）';
            title.appendChild(tag);
        }

        const actions = document.createElement('div');
        actions.className = 'course-editor-row-actions';

        const btnSave = document.createElement('button');
        btnSave.type = 'button';
        btnSave.className = 'btn-secondary';
        btnSave.textContent = '保存';

        const btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'btn-secondary';
        btnDel.textContent = '删除';

        actions.appendChild(btnSave);
        actions.appendChild(btnDel);

        head.appendChild(title);
        head.appendChild(actions);

        const form = document.createElement('div');
        form.className = 'course-editor-form';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = rule.name || '';

        const daySelect = document.createElement('select');
        for (let i = 1; i <= 7; i++) {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = dayLabel[i];
            daySelect.appendChild(opt);
        }
        daySelect.value = String(rule.dayOfWeek || 1);

        const periodInput = document.createElement('input');
        periodInput.type = 'text';
        periodInput.value = rule.periodRange || '';

        const weeksInput = document.createElement('input');
        weeksInput.type = 'text';
        weeksInput.placeholder = '请输入周次，多个周次用逗号分隔';
        weeksInput.placeholder = '请输入周次，多个周次用逗号分隔';
        weeksInput.value = rule.weeksRaw || '';

        const locInput = document.createElement('input');
        locInput.type = 'text';
        locInput.value = rule.location || '';

        const classInput = document.createElement('input');
        classInput.type = 'text';
        classInput.value = rule.className || '';

        const fields = [
            buildLabeledInput('课程', nameInput),
            buildLabeledInput('星期', daySelect),
            buildLabeledInput('节次', periodInput),
            buildLabeledInput('周次', weeksInput),
            buildLabeledInput('地点', locInput),
            buildLabeledInput('班级', classInput)
        ];

        fields.forEach(({ label, inputEl }) => {
            form.appendChild(label);
            form.appendChild(inputEl);
        });

        card.appendChild(head);
        card.appendChild(form);

        const getDraft = () => ({
            id: rule.id,
            rawName: rule.rawName || rule.name,
            name: nameInput.value,
            dayOfWeek: daySelect.value,
            periodRange: periodInput.value,
            weeksRaw: weeksInput.value,
            location: locInput.value,
            className: classInput.value,
            source: rule.source,
            createdAt: rule.createdAt
        });

        btnSave.addEventListener('click', () => {
            const draft = getDraft();
            const nextRuleRes = scheduleLLMNormalizeCourseRuleInput(draft);
            if (!nextRuleRes.ok) {
                alert(nextRuleRes.message);
                return;
            }

            const nextRules = (Array.isArray(scheduleLLMCourseRules) ? scheduleLLMCourseRules : []).map(r => {
                return (r && r.id === rule.id) ? nextRuleRes.rule : r;
            });

            const valid = scheduleLLMValidateCourseRules(nextRules);
            if (!valid.ok) {
                alert(valid.message || '输入不合法');
                return;
            }

            if (valid.warnings && valid.warnings.length > 0) {
                const head = `检测到${valid.warnings.length}处“同一时间同一地点”的课程（可能重复/冲突）。\n\n`;
                const lines = valid.warnings.slice(0, 6).map(w => {
                    const loc = w.location ? ` @${w.location}` : '';
                    return `- 第${w.week}周${w.dayLabel}：${w.a} 与 ${w.b}${loc}`;
                }).join('\n');
                const tail = valid.warnings.length > 6 ? `\n…还有${valid.warnings.length - 6}处未展示` : '';
                const ok = confirm(head + lines + tail + '\n\n仍要保留并继续保存吗？');
                if (!ok) return;
            }

            scheduleLLMSetCourseRules(nextRules, `更新：${nextRuleRes.rule.name}`);
            scheduleLLMRenderCourseEditor(bodyEl);
        });

        btnDel.addEventListener('click', () => {
            const ok = confirm(`确认删除课程“${rule.name || '未命名课程'}”？`);
            if (!ok) return;

            const nextRules = (Array.isArray(scheduleLLMCourseRules) ? scheduleLLMCourseRules : []).filter(r => r && r.id !== rule.id);
            scheduleLLMSetCourseRules(nextRules, `删除：${rule.name || '课程'}`);
            scheduleLLMRenderCourseEditor(bodyEl);
        });

        return card;
    };

    const createAddCard = () => {
        const card = document.createElement('div');
        card.className = 'course-editor-row';

        const head = document.createElement('div');
        head.className = 'course-editor-row-head';

        const title = document.createElement('div');
        title.className = 'course-editor-row-title';
        title.textContent = '添加新课程';

        const actions = document.createElement('div');
        actions.className = 'course-editor-row-actions';

        const btnAdd = document.createElement('button');
        btnAdd.type = 'button';
        btnAdd.className = 'btn-secondary';
        btnAdd.textContent = '添加';

        actions.appendChild(btnAdd);
        head.appendChild(title);
        head.appendChild(actions);

        const form = document.createElement('div');
        form.className = 'course-editor-form';

        const nameInput = document.createElement('input');
        nameInput.type = 'text';

        const daySelect = document.createElement('select');
        for (let i = 1; i <= 7; i++) {
            const opt = document.createElement('option');
            opt.value = String(i);
            opt.textContent = dayLabel[i];
            daySelect.appendChild(opt);
        }
        daySelect.value = '1';

        const periodInput = document.createElement('input');
        periodInput.type = 'text';

        const weeksInput = document.createElement('input');
        weeksInput.type = 'text';

        const locInput = document.createElement('input');
        locInput.type = 'text';

        const classInput = document.createElement('input');
        classInput.type = 'text';

        const fields = [
            buildLabeledInput('课程', nameInput),
            buildLabeledInput('星期', daySelect),
            buildLabeledInput('节次', periodInput),
            buildLabeledInput('周次', weeksInput),
            buildLabeledInput('地点', locInput),
            buildLabeledInput('班级', classInput)
        ];

        fields.forEach(({ label, inputEl }) => {
            form.appendChild(label);
            form.appendChild(inputEl);
        });

        btnAdd.addEventListener('click', () => {
            const draft = {
                id: scheduleLLMNewId(),
                name: nameInput.value,
                dayOfWeek: daySelect.value,
                periodRange: periodInput.value,
                weeksRaw: weeksInput.value,
                location: locInput.value,
                className: classInput.value,
                source: 'manual',
                createdAt: Date.now()
            };

            const nextRuleRes = scheduleLLMNormalizeCourseRuleInput(draft);
            if (!nextRuleRes.ok) {
                alert(nextRuleRes.message);
                return;
            }

            const nextRules = (Array.isArray(scheduleLLMCourseRules) ? scheduleLLMCourseRules : []).concat([nextRuleRes.rule]);
            const valid = scheduleLLMValidateCourseRules(nextRules);
            if (!valid.ok) {
                alert(valid.message || '输入不合法');
                return;
            }

            if (valid.warnings && valid.warnings.length > 0) {
                const head = `检测到${valid.warnings.length}处“同一时间同一地点”的课程（可能重复/冲突）。\n\n`;
                const lines = valid.warnings.slice(0, 6).map(w => {
                    const loc = w.location ? ` @${w.location}` : '';
                    return `- 第${w.week}周${w.dayLabel}：${w.a} 与 ${w.b}${loc}`;
                }).join('\n');
                const tail = valid.warnings.length > 6 ? `\n…还有${valid.warnings.length - 6}处未展示` : '';
                const ok = confirm(head + lines + tail + '\n\n仍要保留并继续添加吗？');
                if (!ok) return;
            }

            scheduleLLMSetCourseRules(nextRules, `添加：${nextRuleRes.rule.name}`);
            scheduleLLMRenderCourseEditor(bodyEl);
        });

        card.appendChild(head);
        card.appendChild(form);
        return card;
    };

    const renderHistory = () => {
        if (!histEl) return;

        const pad2 = (n) => String(n).padStart(2, '0');

        const formatBeijingTime = (ts) => {
            if (!ts) return '';
            const d = new Date(ts);
            if (!Number.isFinite(d.getTime())) return '';

            try {
                if (typeof Intl !== 'undefined' && Intl && typeof Intl.DateTimeFormat === 'function') {
                    return new Intl.DateTimeFormat('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false
                    }).format(d);
                }
            } catch (_) {
            }

            const ms = d.getTime() + 8 * 60 * 60 * 1000;
            const bj = new Date(ms);
            return `${pad2(bj.getUTCHours())}:${pad2(bj.getUTCMinutes())}:${pad2(bj.getUTCSeconds())}`;
        };

        const hist = Array.isArray(scheduleLLMEditHistory) ? scheduleLLMEditHistory : [];
        if (hist.length === 0) {
            histEl.textContent = '';
            return;
        }

        histEl.textContent = '';
        const recent = hist.slice(-8).reverse();
        recent.forEach(h => {
            const row = document.createElement('div');
            row.className = 'course-editor-history-item';
            const t = document.createElement('span');
            t.className = 'course-editor-history-item-time';
            t.textContent = formatBeijingTime(h && h.ts);
            const tx = document.createElement('span');
            tx.className = 'course-editor-history-item-text';
            tx.textContent = h && h.action ? String(h.action) : '修改';
            row.appendChild(t);
            row.appendChild(tx);
            histEl.appendChild(row);
        });
    };

    const render = () => {
        if (listEl) {
            listEl.textContent = '';
            listEl.appendChild(createAddCard());

            const rules = Array.isArray(scheduleLLMCourseRules) ? scheduleLLMCourseRules.slice() : [];
            rules.sort((a, b) => {
                const aManual = a && String(a.source || '') === 'manual';
                const bManual = b && String(b.source || '') === 'manual';
                if (aManual !== bManual) return aManual ? -1 : 1;

                const aCreated = Number.isFinite(Number(a && a.createdAt)) ? Number(a.createdAt) : 0;
                const bCreated = Number.isFinite(Number(b && b.createdAt)) ? Number(b.createdAt) : 0;
                if (aCreated !== bCreated) return bCreated - aCreated;

                const dn = (a.dayOfWeek || 0) - (b.dayOfWeek || 0);
                if (dn) return dn;
                const pn = String(a.periodRange || '').localeCompare(String(b.periodRange || ''), 'zh');
                if (pn) return pn;
                return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
            });

            rules.forEach(r => {
                if (!r || !r.id) return;
                listEl.appendChild(createRuleCard(r));
            });
        }

        renderHistory();
    };

    render();
}

// Rendering Logic
function scheduleLLMMonthStart(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
}

function scheduleLLMCompareMonth(a, b) {
    return (a.getFullYear() - b.getFullYear()) || (a.getMonth() - b.getMonth());
}

function scheduleLLMWeekNumberForDate(d) {
    if (!scheduleLLMSemesterStartDate || !(scheduleLLMSemesterStartDate instanceof Date) || !Number.isFinite(scheduleLLMSemesterStartDate.getTime())) return null;
    if (!d || !(d instanceof Date) || !Number.isFinite(d.getTime())) return null;

    const startUtc = Date.UTC(scheduleLLMSemesterStartDate.getFullYear(), scheduleLLMSemesterStartDate.getMonth(), scheduleLLMSemesterStartDate.getDate());
    const dayUtc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    const diffDays = Math.floor((dayUtc - startUtc) / 86400000);
    const weekNum = Math.floor(diffDays / 7) + 1;

    if (!Number.isFinite(weekNum) || weekNum <= 0) return null;
    return weekNum;
}

function scheduleLLMSetMonthRangeFromEvents(events) {
    if (!Array.isArray(events) || events.length === 0) {
        scheduleLLMMinMonth = null;
        scheduleLLMMaxMonth = null;
        return;
    }
    let minTime = Infinity;
    let maxTime = -Infinity;
    events.forEach(e => {
        const t = e && e.date ? e.date.getTime() : NaN;
        if (!Number.isFinite(t)) return;
        if (t < minTime) minTime = t;
        if (t > maxTime) maxTime = t;
    });
    if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) {
        scheduleLLMMinMonth = null;
        scheduleLLMMaxMonth = null;
        return;
    }
    scheduleLLMMinMonth = scheduleLLMMonthStart(new Date(minTime));
    scheduleLLMMaxMonth = scheduleLLMMonthStart(new Date(maxTime));
}

function scheduleLLMClampMonthToRange(d) {
    const m = scheduleLLMMonthStart(d);
    if (scheduleLLMMinMonth && scheduleLLMCompareMonth(m, scheduleLLMMinMonth) < 0) return new Date(scheduleLLMMinMonth);
    if (scheduleLLMMaxMonth && scheduleLLMCompareMonth(m, scheduleLLMMaxMonth) > 0) return new Date(scheduleLLMMaxMonth);
    return m;
}

function scheduleLLMFormatMonthTitle(d) {
    return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

function scheduleLLMCourseListEls() {
    const panel = document.getElementById('courseListPanel');
    if (!panel) return null;
    return {
        panel,
        toggle: document.getElementById('courseListToggle'),
        summary: document.getElementById('courseListSummary'),
        body: document.getElementById('courseListBody'),
        content: document.getElementById('courseListContent')
    };
}

function scheduleLLMSetCourseListVisible(visible) {
    const els = scheduleLLMCourseListEls();
    if (!els || !els.panel) return;

    const on = !!visible;
    els.panel.style.display = on ? '' : 'none';

    if (!on) {
        els.panel.classList.remove('is-open');
        if (els.toggle) els.toggle.setAttribute('aria-expanded', 'false');
    }
}

function scheduleLLMUpdateCourseListForMonth(monthDate) {
    const els = scheduleLLMCourseListEls();
    if (!els || !els.content) return;

    const y = monthDate.getFullYear();
    const m = monthDate.getMonth();

    const monthEvents = generatedEvents
        .filter(e => e && e.date && e.date.getFullYear() === y && e.date.getMonth() === m)
        .slice()
        .sort((a, b) => {
            const ta = a.date.getTime();
            const tb = b.date.getTime();
            if (ta !== tb) return ta - tb;
            if ((a.period || 0) !== (b.period || 0)) return (a.period || 0) - (b.period || 0);
            return String(a.title || '').localeCompare(String(b.title || ''), 'zh');
        });

    if (els.summary) els.summary.textContent = String(monthEvents.length);

    if (monthEvents.length === 0) {
        els.content.innerHTML = '<div class="course-list-empty">本月无课程</div>';
        return;
    }

    const byDay = new Map();
    monthEvents.forEach(ev => {
        const k = ev.date.toISOString().slice(0, 10);
        if (!byDay.has(k)) byDay.set(k, []);
        byDay.get(k).push(ev);
    });

    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

    const parts = [];
    Array.from(byDay.keys()).sort().forEach(k => {
        const list = byDay.get(k) || [];
        const d = list[0] && list[0].date ? list[0].date : new Date(k);
        const title = `${d.getMonth() + 1}月${d.getDate()}日 ${dayNames[d.getDay()] || ''}`;
        parts.push(`<div class="course-list-group"><div class="course-list-group-title"><span>${title}</span><span>${list.length}门</span></div><div class="course-list-items">`);
        list.forEach(ev => {
            const pRange = ev.periodRange ? ev.periodRange : ev.period;
            const time = ev.startTime && ev.endTime ? `${ev.startTime}-${ev.endTime}` : '';
            const loc = ev.location ? String(ev.location) : '—';
            const wk = ev.week ? `第${ev.week}周` : '';
            const dayIdx = Number.isFinite(ev.dayOfWeek)
                ? ev.dayOfWeek
                : (ev.date ? ((ev.date.getDay() === 0) ? 7 : ev.date.getDay()) : null);
            const dayLabel = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日'][dayIdx] || '';
            parts.push(
                `<div class="course-list-item">` +
                `<div class="course-list-item-head"><div class="course-list-item-name">${String(ev.title || '未命名课程')}</div><div class="course-list-item-meta"><span>${wk}</span><span>${dayLabel}</span><span>第${String(pRange)}节</span></div></div>` +
                `<div class="course-list-item-meta"><span>${time}</span><span>${loc}</span></div>` +
                `</div>`
            );
        });
        parts.push('</div></div>');
    });

    els.content.innerHTML = parts.join('');
}

function scheduleLLMEnsureCalendarScaffold() {
    const container = document.getElementById('calendarArea');
    if (!container) return null;

    let nav = container.querySelector('.calendar-nav');
    let viewport = container.querySelector('.calendar-month-viewport');

    if (!nav || !viewport) {
        container.innerHTML = '';

        nav = document.createElement('div');
        nav.className = 'calendar-nav no-print';
        nav.innerHTML = `
            <button type="button" class="calendar-nav-btn prev">前一个月</button>
            <div class="calendar-nav-center">
                <div class="calendar-nav-title"></div>
                <button type="button" class="calendar-nav-btn editor" id="btnCourseEditor">核对/编辑</button>
            </div>
            <button type="button" class="calendar-nav-btn next">后一个月</button>
        `;

        viewport = document.createElement('div');
        viewport.className = 'calendar-month-viewport';

        container.appendChild(nav);
        container.appendChild(viewport);
    }

    const prevBtn = nav.querySelector('button.prev');
    const nextBtn = nav.querySelector('button.next');
    if (prevBtn) prevBtn.onclick = () => scheduleLLMChangeMonth(-1);
    if (nextBtn) nextBtn.onclick = () => scheduleLLMChangeMonth(1);

    let editBtn = nav.querySelector('#btnCourseEditor');
    if (!editBtn) {
        const center = nav.querySelector('.calendar-nav-center');
        if (center) {
            editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'calendar-nav-btn editor';
            editBtn.id = 'btnCourseEditor';
            editBtn.textContent = '核对/编辑';
            center.appendChild(editBtn);
        }
    }

    if (editBtn) {
        editBtn.onclick = () => {
            const fn = (typeof window !== 'undefined') ? window.scheduleLLMOpenSiteModal : null;
            if (typeof fn === 'function') fn('editor');
        };
    }

    return {
        container,
        nav,
        viewport,
        titleEl: nav.querySelector('.calendar-nav-title'),
        prevBtn: prevBtn,
        nextBtn: nextBtn,
        editBtn: editBtn
    };
}

function scheduleLLMRenderMonth(date, direction) {
    const els = scheduleLLMEnsureCalendarScaffold();
    if (!els) return;

    const monthDate = scheduleLLMMonthStart(date);
    currentCalendarDate = monthDate;

    if (els.titleEl) els.titleEl.textContent = scheduleLLMFormatMonthTitle(monthDate);
    if (els.editBtn) {
        els.editBtn.disabled = !(Array.isArray(scheduleLLMCourseRules) && scheduleLLMCourseRules.length > 0);
    }

    const prevTarget = scheduleLLMMonthStart(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1));
    const nextTarget = scheduleLLMMonthStart(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1));

    if (els.prevBtn) els.prevBtn.disabled = !!scheduleLLMMinMonth && scheduleLLMCompareMonth(prevTarget, scheduleLLMMinMonth) < 0;
    if (els.nextBtn) els.nextBtn.disabled = !!scheduleLLMMaxMonth && scheduleLLMCompareMonth(nextTarget, scheduleLLMMaxMonth) > 0;

    const render = () => {
        els.viewport.innerHTML = '';
        els.viewport.appendChild(createMonthCalendarElement(monthDate, { includeTitle: false }));
    };

    const reduce = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const canAnim = !reduce && els.viewport && typeof els.viewport.animate === 'function';

    if (!canAnim || !direction) {
        render();
        scheduleLLMUpdateCourseListForMonth(monthDate);
        return;
    }

    const outDx = direction > 0 ? -12 : 12;
    const inDx = direction > 0 ? 12 : -12;

    els.viewport
        .animate([{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${outDx}px)` }], { duration: 160, easing: 'ease' })
        .finished
        .catch(() => {})
        .then(() => {
            render();
            scheduleLLMUpdateCourseListForMonth(monthDate);
            els.viewport.animate([{ opacity: 0, transform: `translateX(${inDx}px)` }, { opacity: 1, transform: 'translateX(0)' }], { duration: 200, easing: 'ease' });
        });
}

function scheduleLLMChangeMonth(delta) {
    const base = scheduleLLMMonthStart(currentCalendarDate || new Date());
    const target = new Date(base.getFullYear(), base.getMonth() + delta, 1);
    const clamped = scheduleLLMClampMonthToRange(target);
    if (scheduleLLMCompareMonth(base, clamped) === 0) return;
    scheduleLLMRenderMonth(clamped, delta);
}

function renderCalendar(events) {
    scheduleLLMSetCourseListVisible(Array.isArray(events) && events.length > 0);
    scheduleLLMSetMonthRangeFromEvents(events);
    const target = (Array.isArray(events) && events.length > 0 && scheduleLLMMinMonth) ? new Date(scheduleLLMMinMonth) : scheduleLLMMonthStart(new Date());
    scheduleLLMRenderMonth(target, 0);
}

function formatWeekRanges(weeks) {
    const utils = (typeof window !== 'undefined' && window.ScheduleLLMTimeUtils) ? window.ScheduleLLMTimeUtils : null;
    if (utils && typeof utils.formatWeekRanges === 'function') {
        return utils.formatWeekRanges(weeks);
    }

    if (!weeks || weeks.length === 0) return "";
    const uniqueWeeks = Array.from(new Set(weeks)).sort((a, b) => a - b);
    const ranges = [];
    let start = uniqueWeeks[0];
    let end = uniqueWeeks[0];

    for (let i = 1; i < uniqueWeeks.length; i++) {
        if (uniqueWeeks[i] === end + 1) {
            end = uniqueWeeks[i];
        } else {
            ranges.push(start === end ? `${start}` : `${start}-${end}`);
            start = uniqueWeeks[i];
            end = uniqueWeeks[i];
        }
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    return `第${ranges.join(',')}周`;
}

function createMonthCalendarElement(date, options) {
    const year = date.getFullYear();
    const month = date.getMonth();

    const includeTitle = !(options && options.includeTitle === false);
    const printMode = !!(options && options.printMode);

    const monthContainer = document.createElement('div');
    monthContainer.className = 'month-container';

    if (includeTitle) {
        const title = document.createElement('div');
        title.className = 'month-title';
        title.textContent = `${year}年 ${month + 1}月`;
        monthContainer.appendChild(title);
    }

    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    let hasWeekendCourses = false;

    // Header
    const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    days.forEach(d => {
        const dh = document.createElement('div');
        dh.className = 'calendar-header-cell';
        dh.textContent = d;
        grid.appendChild(dh);
    });

    // Days
    // Calculate first day of month
    const firstDayOfMonth = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    
    // Adjust logic: Week starts on Monday (1) -> Sunday (7)
    // getDay(): 0(Sun), 1(Mon)...
    let startDayOfWeek = firstDayOfMonth.getDay(); 
    if (startDayOfWeek === 0) startDayOfWeek = 7; // Convert Sun 0 to 7

    // Empty slots before 1st
    for (let i = 1; i < startDayOfWeek; i++) {
        const empty = document.createElement('div');
        empty.className = 'calendar-day empty';
        grid.appendChild(empty);
    }

    // Days
    for (let d = 1; d <= daysInMonth; d++) {
        const currentDayDate = new Date(year, month, d);
        const dayEl = document.createElement('div');
        dayEl.className = 'calendar-day';
        
        // Find events for this day
        const dayEvents = generatedEvents.filter(e => 
            e.date.getFullYear() === year && 
            e.date.getMonth() === month && 
            e.date.getDate() === d
        );

        // Sort by start time
        dayEvents.sort((a, b) => a.period - b.period);

        // Header: Day Num + Week Badge (if Monday)
        const dayNumRow = document.createElement('div');
        dayNumRow.className = 'day-number';
        
        const daySpan = document.createElement('span');
        daySpan.textContent = d;
        dayNumRow.appendChild(daySpan);

        // Add Week Badge if it's Monday or 1st of month (to show context)
        // Or just show for any day that has events? No, consistency.
        // Let's show for every Monday and the 1st day of month.
        let dayOfWeek = currentDayDate.getDay();
        if (dayOfWeek === 0) dayOfWeek = 7;

        if (dayOfWeek === 1 || d === 1) {
            let weekNum = null;
            if (dayEvents.length > 0 && Number.isFinite(dayEvents[0].week)) {
                weekNum = dayEvents[0].week;
            } else {
                weekNum = scheduleLLMWeekNumberForDate(currentDayDate);
            }

            if (Number.isFinite(weekNum) && weekNum > 0) {
                const badge = document.createElement('span');
                badge.className = 'week-badge';
                badge.textContent = `第${weekNum}周`;
                dayNumRow.appendChild(badge);
            }
        }

        dayEl.appendChild(dayNumRow);

        if (printMode && (dayOfWeek === 6 || dayOfWeek === 7)) {
            dayEl.classList.add('weekend');
        }

        const eventsWrap = document.createElement('div');
        eventsWrap.className = 'day-events';

        // Render Events
        // 1. Group Events for Joint Classes (Combined Display)
        // Key: Time + Location + Course Name
        const groupedEvents = new Map();

        dayEvents.forEach(ev => {
            const key = `${ev.period}-${ev.location}-${ev.title}-${ev.className || ''}`;
            if (!groupedEvents.has(key)) {
                groupedEvents.set(key, {
                    ...ev,
                    classNames: [ev.className]
                });
            } else {
                const existing = groupedEvents.get(key);
                if (ev.className && !existing.classNames.includes(ev.className)) {
                    existing.classNames.push(ev.className);
                }
            }
        });

        // Convert Map back to Array
        const displayEvents = Array.from(groupedEvents.values());
        const limitedEvents = printMode ? displayEvents.slice(0, 5) : displayEvents;

        if (printMode && dayEl.classList.contains('weekend')) {
            if (limitedEvents.length === 0) {
                dayEl.classList.add('print-narrow');
            } else {
                hasWeekendCourses = true;
            }
        }

        if (printMode && !dayEl.classList.contains('print-narrow') && limitedEvents.length > 0) {
            const marker = document.createElement('span');
            marker.className = 'day-marker';
            marker.textContent = `${limitedEvents.length}课`;
            dayNumRow.appendChild(marker);
        }

        limitedEvents.forEach(ev => {
            const evEl = document.createElement('div');
            evEl.className = `event-item type-${ev.timeOfDay}`;

            const pRange = ev.periodRange ? ev.periodRange : ev.period;

            if (printMode) {
                const loc = ev.location ? String(ev.location) : '';
                const title = ev.title ? String(ev.title) : '';
                evEl.innerHTML = `
                    <div class="ev-print-line1">${String(pRange)}节 ${loc}</div>
                    <div class="ev-print-line2">${title}</div>
                `;
            } else {
                const utils = (typeof window !== 'undefined' && window.ScheduleLLMTimeUtils) ? window.ScheduleLLMTimeUtils : null;
                const tooltipInfo = (utils && typeof utils.formatClassAndWeeksLines === 'function')
                    ? utils.formatClassAndWeeksLines(ev.classNames, ev.weeks)
                    : (() => {
                        const weeksText = formatWeekRanges(ev.weeks);
                        const cleanNames = (Array.isArray(ev.classNames) ? ev.classNames : [])
                            .filter(n => n)
                            .map(n => String(n).replace(/^[\(（]/, '').replace(/[\)）]$/, ''));
                        const tooltipClassText = cleanNames.length > 0 ? cleanNames.join('/') : "";
                        const lines = [];
                        if (tooltipClassText) lines.push(tooltipClassText);
                        if (weeksText) lines.push(weeksText);
                        return { classText: tooltipClassText, weeksText, lines };
                    })();

                const tooltipClassText = tooltipInfo.classText;
                const weeksText = tooltipInfo.weeksText;

                evEl.innerHTML = `
                    <div class="ev-header">
                        <span class="ev-period">第${pRange}节</span>
                        <span class="ev-location-separator">@</span>
                        <span class="ev-location">${ev.location}</span>
                    </div>
                    <div class="ev-course-name">
                        ${ev.title}
                        <div class="ev-tooltip">
                            ${tooltipClassText ? `<div>${tooltipClassText}</div>` : ''}
                            <div>${weeksText}</div>
                        </div>
                    </div>
                `;
            }

            eventsWrap.appendChild(evEl);
        });

        dayEl.appendChild(eventsWrap);
        grid.appendChild(dayEl);
    }

    if (printMode && hasWeekendCourses) {
        grid.classList.add('print-weekend-has-courses');
    }

    monthContainer.appendChild(grid);

    if (printMode) {
        const footer = document.createElement('div');
        footer.className = 'print-page-footer';

        const logo = document.createElement('img');
        logo.src = 'Logo_yedaoai_Green_Web600.png';
        logo.alt = 'YedaoAI';
        logo.loading = 'lazy';
        logo.decoding = 'async';
        logo.style.height = '16px';
        logo.style.maxHeight = '16px';
        logo.style.width = 'auto';

        const text = document.createElement('span');
        text.textContent = 'yedaoai.com';

        footer.appendChild(logo);
        footer.appendChild(text);
        monthContainer.appendChild(footer);
    }

    return monthContainer;
}

// Print Handler
const btnPrint = document.getElementById('btnPrint');
if (btnPrint) {
    btnPrint.addEventListener('click', () => {
        if (generatedEvents.length === 0) {
            alert("无日程数据");
            return;
        }

        let minTime = Infinity;
        let maxTime = -Infinity;
        generatedEvents.forEach(e => {
            const t = e.date.getTime();
            if (t < minTime) minTime = t;
            if (t > maxTime) maxTime = t;
        });

        const startDate = new Date(minTime);
        const startYear = startDate.getFullYear();
        const startMonth = startDate.getMonth();

        const endDate = new Date(maxTime);
        const endYear = endDate.getFullYear();
        const endMonth = endDate.getMonth();

        const area = document.getElementById('calendarArea');
        if (!area) {
            alert("找不到月历容器");
            return;
        }

        const OriginalHTML = area.innerHTML;

        const restore = () => {
            area.innerHTML = OriginalHTML;

            const base = (currentCalendarDate instanceof Date && Number.isFinite(currentCalendarDate.getTime()))
                ? currentCalendarDate
                : new Date();

            if (typeof scheduleLLMRenderMonth === 'function') {
                scheduleLLMRenderMonth(base, 0);
            }

            window.dispatchEvent(new Event('resize'));
        };

        area.innerHTML = '';

        const bar = document.createElement('div');
        bar.className = 'no-print';
        bar.style.position = 'sticky';
        bar.style.top = '0';
        bar.style.zIndex = '9999';
        bar.style.display = 'flex';
        bar.style.justifyContent = 'space-between';
        bar.style.alignItems = 'center';
        bar.style.gap = '10px';
        bar.style.padding = '10px 12px';
        bar.style.marginBottom = '10px';
        bar.style.border = '1px solid #e2e8f0';
        bar.style.borderRadius = '10px';
        bar.style.background = '#ffffff';
        bar.style.boxShadow = '0 1px 2px 0 rgb(0 0 0 / 0.05)';
        bar.innerHTML = `<div style="font-weight:800; color:#0f172a;">打印预览</div><div style="display:flex; gap:10px;"><button type="button" id="scheduleLLMPrintDo" style="padding:8px 12px; border-radius:10px; border:1px solid #e2e8f0; background:#2563eb; color:#fff; font-weight:800; cursor:pointer;">打印</button><button type="button" id="scheduleLLMPrintCancel" style="padding:8px 12px; border-radius:10px; border:1px solid #e2e8f0; background:#fff; color:#0f172a; font-weight:800; cursor:pointer;">返回</button></div>`;

        const printContainer = document.createElement('div');
        printContainer.className = 'print-all-container';

        let iterDate = new Date(startYear, startMonth, 1);
        while (iterDate.getFullYear() < endYear || (iterDate.getFullYear() === endYear && iterDate.getMonth() <= endMonth)) {
            const monthEl = createMonthCalendarElement(new Date(iterDate), { printMode: true });
            printContainer.appendChild(monthEl);
            iterDate.setMonth(iterDate.getMonth() + 1);
        }

        area.appendChild(bar);
        area.appendChild(printContainer);

        const doBtn = document.getElementById('scheduleLLMPrintDo');
        const cancelBtn = document.getElementById('scheduleLLMPrintCancel');

        if (cancelBtn) {
            cancelBtn.addEventListener('click', restore);
        }

        if (doBtn) {
            doBtn.addEventListener('click', () => {
                doBtn.disabled = true;
                doBtn.style.opacity = '0.8';
                window.print();
                setTimeout(restore, 1000);
            });
        }
    });
}

async function scheduleLLMTestPrintEditorFlow() {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const assert = (cond, msg) => {
        if (!cond) throw new Error(msg);
    };

    const backdrop = document.getElementById('siteModalBackdrop');
    assert(backdrop, '找不到弹窗容器 #siteModalBackdrop');

    const openEditorAndClose = async () => {
        const btn = document.getElementById('btnCourseEditor');
        assert(btn, '找不到“核对/编辑”按钮 #btnCourseEditor');
        btn.click();
        await sleep(60);
        assert(!backdrop.hidden, '点击“核对/编辑”后弹窗未打开');

        const titleEl = document.getElementById('siteModalTitle');
        assert(titleEl && String(titleEl.textContent || '').includes('核对'), '弹窗标题不正确或未渲染');

        const closeBtn = document.getElementById('siteModalClose');
        assert(closeBtn, '找不到弹窗关闭按钮 #siteModalClose');
        closeBtn.click();
        await sleep(240);
        assert(backdrop.hidden, '关闭弹窗后 backdrop 未隐藏');
    };

    assert(Array.isArray(generatedEvents) && generatedEvents.length > 0, '请先生成月历：generatedEvents 为空');
    await openEditorAndClose();

    const printBtn = document.getElementById('btnPrint');
    assert(printBtn, '找不到“打印月历”按钮 #btnPrint');
    printBtn.click();
    await sleep(60);

    const cancelBtn = document.getElementById('scheduleLLMPrintCancel');
    assert(cancelBtn, '未进入打印预览或找不到返回按钮 #scheduleLLMPrintCancel');
    cancelBtn.click();
    await sleep(120);

    await openEditorAndClose();
    return true;
}

if (typeof window !== 'undefined') {
    window.scheduleLLMTestPrintEditorFlow = scheduleLLMTestPrintEditorFlow;
}

// Export Logic
document.getElementById('btnExport').addEventListener('click', () => {
    if (generatedEvents.length === 0) {
        alert("无日程数据");
        return;
    }

    // Generate ICS content
    let device = document.getElementById('exportTarget').value;
    let prodId = "-//ScheduleLLM//CN";
    if (device === 'windows') prodId = "-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN";
    if (device === 'ios') prodId = "-//Apple Inc.//iOS 15.0//EN";

    const alarmEnabledEl = document.getElementById('exportAlarmEnabled');
    const alarmMinutesEl = document.getElementById('exportAlarmMinutes');

    let alarmEnabled = alarmEnabledEl ? !!alarmEnabledEl.checked : true;
    let alarmMinutes = alarmMinutesEl ? parseInt(alarmMinutesEl.value, 10) : 15;
    if (!Number.isFinite(alarmMinutes) || alarmMinutes < 0) alarmMinutes = 15;

    const utils = (typeof window !== 'undefined' && window.ScheduleLLMTimeUtils) ? window.ScheduleLLMTimeUtils : null;

    const icsEscapeText = (utils && typeof utils.icsEscapeText === 'function')
        ? utils.icsEscapeText
        : (val) => String(val == null ? '' : val)
            .replace(/\\/g, '\\\\')
            .replace(/\r\n|\r|\n/g, '\\n')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,');

    const icsFoldLine = (utils && typeof utils.icsFoldLine === 'function')
        ? utils.icsFoldLine
        : (line) => String(line == null ? '' : line);

    const scheduleLLMDayStrForExport = (d) => String(d.toISOString().split('T')[0]).replace(/-/g, '');

    const scheduleLLMInstanceClassNames = new Map();
    generatedEvents.forEach(ev => {
        const dayStr = scheduleLLMDayStrForExport(ev.date);
        const key = `${dayStr}-${ev.period}-${ev.location}-${ev.title}`;
        if (!scheduleLLMInstanceClassNames.has(key)) scheduleLLMInstanceClassNames.set(key, []);
        const arr = scheduleLLMInstanceClassNames.get(key);
        if (ev.className && !arr.includes(ev.className)) arr.push(ev.className);
    });

    const scheduleLLMBuildExportDescription = (ev) => {
        const dayStr = scheduleLLMDayStrForExport(ev.date);
        const key = `${dayStr}-${ev.period}-${ev.location}-${ev.title}`;
        const classNames = scheduleLLMInstanceClassNames.get(key) || (ev.className ? [ev.className] : []);

        const info = (utils && typeof utils.formatClassAndWeeksLines === 'function')
            ? utils.formatClassAndWeeksLines(classNames, ev.weeks)
            : (() => {
                const weeksText = formatWeekRanges(ev.weeks);
                const cleanNames = (Array.isArray(classNames) ? classNames : [])
                    .filter(n => n)
                    .map(n => String(n).replace(/^[\(（]/, '').replace(/[\)）]$/, ''))
                    .filter(Boolean);
                const classText = cleanNames.length > 0 ? cleanNames.join('/') : '';
                const lines = [];
                if (classText) lines.push(classText);
                if (weeksText) lines.push(weeksText);
                return { lines };
            })();

        return (info && Array.isArray(info.lines)) ? info.lines.join('\n') : '';
    };

    const scheduleLLMExportSlots = (typeof scheduleLLMGetTimeSlotsFromInputs === 'function')
        ? scheduleLLMGetTimeSlotsFromInputs()
        : (Array.isArray(defaultTimeSlots) ? defaultTimeSlots : []);

    const scheduleLLMGetExportTimeRangeForEvent = (ev) => {
        const periodRange = ev && ev.periodRange ? ev.periodRange : '';
        const fallbackPeriod = ev && Number.isFinite(ev.period) ? ev.period : null;

        const tr = (utils && typeof utils.getTimeRangeForPeriod === 'function')
            ? utils.getTimeRangeForPeriod(scheduleLLMExportSlots, periodRange, fallbackPeriod)
            : null;

        if (!tr) {
            const startTime = ev && ev.startTime ? ev.startTime : '';
            const endTime = ev && ev.endTime ? ev.endTime : '';
            if (!startTime || !endTime) {
                console.warn('[ExportTimeInvalid]', { title: ev && ev.title, periodRange, fallbackPeriod, startTime, endTime });
            }
            return { startTime, endTime, source: 'event' };
        }

        if (ev && ev.startTime && ev.endTime && (ev.startTime !== tr.startTime || ev.endTime !== tr.endTime)) {
            console.warn('[ExportTimeMismatch]', {
                title: ev.title,
                periodRange,
                period: fallbackPeriod,
                eventTime: `${ev.startTime}-${ev.endTime}`,
                exportTime: `${tr.startTime}-${tr.endTime}`
            });
        }

        return { startTime: tr.startTime, endTime: tr.endTime, source: 'settings' };
    };

    let icsContent = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:${prodId}\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\n`;

    // Windows Outlook: Add TimeZone Definition? 
    // Simplify for now, usually VEVENT stats are enough.

    if (device === 'vcard') {
        // Export as vCalendar 1.0 (.vcs) which is often compatible with older systems or "Contact Schedules"
        let vcsContent = `BEGIN:VCALENDAR\r\nVERSION:1.0\r\nPRODID:-//ScheduleLLM//CN\r\nTZ:-08\r\n`;

        generatedEvents.forEach(ev => {
            const dayStr = scheduleLLMDayStrForExport(ev.date);
            const tr = scheduleLLMGetExportTimeRangeForEvent(ev);
            const startStr = `${dayStr}T${String(tr.startTime || '').replace(/:/g, '')}00`;
            const endStr = `${dayStr}T${String(tr.endTime || '').replace(/:/g, '')}00`;

            if (!tr.startTime || !tr.endTime) {
                console.warn('[VCSExportMissingTime]', { title: ev && ev.title, dayStr, periodRange: ev && ev.periodRange, period: ev && ev.period, source: tr.source });
            }

            const description = scheduleLLMBuildExportDescription(ev);

            vcsContent += "BEGIN:VEVENT\r\n";
            vcsContent += icsFoldLine(`SUMMARY:${icsEscapeText(ev.title)}`) + "\r\n";
            vcsContent += `DTSTART:${startStr}\r\n`;
            vcsContent += `DTEND:${endStr}\r\n`;
            vcsContent += icsFoldLine(`LOCATION:${icsEscapeText(ev.location)}`) + "\r\n";
            vcsContent += icsFoldLine(`DESCRIPTION:${icsEscapeText(description)}`) + "\r\n";
            vcsContent += "END:VEVENT\r\n";
        });

        vcsContent += "END:VCALENDAR";

        const blob = new Blob([vcsContent], { type: 'text/x-vcalendar;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `schedule_export.vcs`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
    }

    generatedEvents.forEach(ev => {
        // Format Date: YYYYMMDDTHHMMSS
        const dayStr = scheduleLLMDayStrForExport(ev.date);
        const tr = scheduleLLMGetExportTimeRangeForEvent(ev);
        const startStr = `${dayStr}T${String(tr.startTime || '').replace(/:/g, '')}00`;
        const endStr = `${dayStr}T${String(tr.endTime || '').replace(/:/g, '')}00`;

        if (!tr.startTime || !tr.endTime) {
            console.warn('[ICSExportMissingTime]', { title: ev && ev.title, dayStr, periodRange: ev && ev.periodRange, period: ev && ev.period, source: tr.source });
        }

        let description = ev.description;
        if (device === 'ios') {
            // iOS sometimes likes cleaner description
        }

        icsContent += "BEGIN:VEVENT\r\n";
        icsContent += `UID:${Date.now()}-${Math.random()}@schedulellm\r\n`;
        icsContent += `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z\r\n`;
        icsContent += `DTSTART;TZID=Asia/Shanghai:${startStr}\r\n`;
        icsContent += `DTEND;TZID=Asia/Shanghai:${endStr}\r\n`;
        description = scheduleLLMBuildExportDescription(ev);

        icsContent += icsFoldLine(`SUMMARY:${icsEscapeText(ev.title)}`) + "\r\n";
        icsContent += icsFoldLine(`LOCATION:${icsEscapeText(ev.location)}`) + "\r\n";
        icsContent += icsFoldLine(`DESCRIPTION:${icsEscapeText(description)}`) + "\r\n";

        // Alarms
        if ((device === 'ios' || device === 'android') && alarmEnabled && alarmMinutes > 0) {
            icsContent += `BEGIN:VALARM\r\nTRIGGER:-PT${alarmMinutes}M\r\nACTION:DISPLAY\r\nDESCRIPTION:Reminder\r\nEND:VALARM\r\n`;
        }

        // Windows Outlook specific categories?
        if (device === 'windows') {
            const cat = ev.timeOfDay === 'morning' ? 'Blue Category' : (ev.timeOfDay === 'afternoon' ? 'Orange Category' : 'Purple Category');
            // icsContent += `CATEGORIES:${cat}\r\n`; // Outlook might need Master List, but safe to add
            icsContent += `X-MICROSOFT-CDO-BUSYSTATUS:BUSY\r\n`;
        }

        icsContent += "END:VEVENT\r\n";
    });

    icsContent += "END:VCALENDAR";

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `schedule_${device}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

// HTML Export
document.getElementById('btnSaveHtml').addEventListener('click', async () => {
    if (generatedEvents.length === 0) {
        alert("无日程数据");
        return;
    }

    // 1. Calculate Date Range (Copy from Print logic)
    let minTime = Infinity;
    let maxTime = -Infinity;
    generatedEvents.forEach(e => {
        const t = e.date.getTime();
        if (t < minTime) minTime = t;
        if (t > maxTime) maxTime = t;
    });

    const startDate = new Date(minTime);
    const startYear = startDate.getFullYear();
    const startMonth = startDate.getMonth();

    const endDate = new Date(maxTime);
    const endYear = endDate.getFullYear();
    const endMonth = endDate.getMonth();

    // 2. Generate Content
    const container = document.createElement('div');
    container.className = 'print-all-container'; // Reuse print container class for layout

    let iterDate = new Date(startYear, startMonth, 1);
    while (iterDate.getFullYear() < endYear || (iterDate.getFullYear() === endYear && iterDate.getMonth() <= endMonth)) {
        const monthEl = createMonthCalendarElement(new Date(iterDate));
        container.appendChild(monthEl);
        iterDate.setMonth(iterDate.getMonth() + 1);
    }

    // 3. Define a vibrant and modern stylesheet for the export
    const cssText = `
        :root {
            --primary: #3b82f6;
            --bg: #f1f5f9;
            --card-bg: #ffffff;
            --text-main: #1e293b;
            --text-muted: #64748b;
            --border: #e2e8f0;
            --morning: #10b981;
            --afternoon: #f59e0b;
            --evening: #6366f1;
            --radius: 12px;
            --shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }

        body { 
            background: var(--bg); 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; 
            color: var(--text-main);
            line-height: 1.5;
            padding: 40px 20px;
            overflow-y: auto;
            height: auto;
        }

        .export-header {
            max-width: 1200px;
            margin: 0 auto 40px auto;
            text-align: center;
        }

        .export-title {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            font-size: 2.5rem;
            font-weight: 800;
            color: var(--primary);
            margin-bottom: 8px;
            letter-spacing: -0.025em;
        }

        .export-logo {
            height: 1em;
            width: auto;
            flex: 0 0 auto;
        }

        .export-header p {
            color: var(--text-muted);
            font-size: 1.1rem;
        }

        .export-site-link {
            color: inherit;
            text-decoration: none;
            border-bottom: 1px solid currentColor;
        }

        .export-site-link:hover {
            opacity: 0.9;
        }

        .content-wrapper {
            max-width: 1200px;
            margin: 0 auto;
        }

        .month-container { 
            background: var(--card-bg);
            border-radius: var(--radius);
            box-shadow: var(--shadow);
            padding: 24px;
            margin-bottom: 40px; 
            border: 1px solid var(--border);
        }

        .month-title { 
            font-size: 1.5rem;
            font-weight: 700;
            color: var(--text-main);
            margin-bottom: 20px;
            text-align: left;
            padding-left: 8px;
            border-left: 4px solid var(--primary);
        }

        .calendar-grid { 
            display: grid; 
            grid-template-columns: repeat(7, 1fr); 
            gap: 12px; 
        }

        .calendar-header-cell { 
            text-align: center; 
            color: var(--text-muted);
            font-size: 0.875rem;
            font-weight: 600;
            padding: 8px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .calendar-day { 
            background: #f8fafc;
            border: 1px solid var(--border);
            border-radius: 8px;
            min-height: 120px; 
            padding: 8px; 
            display: flex;
            flex-direction: column;
            gap: 6px;
            transition: transform 0.2s, box-shadow 0.2s;
        }

        .calendar-day:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1);
            background: #fff;
        }

        .calendar-day.empty { 
            background: transparent;
            border: 1px dashed var(--border);
        }

        .day-number { 
            font-size: 0.875rem; 
            font-weight: 700;
            display: flex; 
            justify-content: space-between; 
            align-items: center;
            margin-bottom: 4px;
            color: var(--text-muted);
        }

        .week-badge {
            font-size: 0.7rem;
            background: #eff6ff;
            color: var(--primary);
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 600;
        }

        .event-item { 
            padding: 6px 8px; 
            border-radius: 6px;
            font-size: 0.75rem; 
            font-weight: 500;
            line-height: 1.3;
            border-left: 3px solid transparent;
        }

        .type-morning { 
            background: #ecfdf5; 
            color: #065f46;
            border-left-color: var(--morning); 
        }

        .type-afternoon { 
            background: #fffbeb; 
            color: #92400e;
            border-left-color: var(--afternoon); 
        }

        .type-evening { 
            background: #f5f3ff; 
            color: #3730a3;
            border-left-color: var(--evening); 
        }

        .ev-time { 
            font-weight: 700; 
            display: block;
            font-size: 0.7rem;
            opacity: 0.8;
            margin-bottom: 2px;
        }

        .ev-location { 
            display: block;
            font-size: 0.7rem;
            font-style: italic;
            margin-top: 2px;
            opacity: 0.8;
            margin-bottom: 2px;
        }

        .ev-title {
            word-break: break-word;
        }
        
        /* Tooltip Styles for Export */
        .ev-header {
            font-size: 12px;
            font-weight: 400;
            color: var(--text-muted);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            display: flex;
            align-items: center;
            gap: 2px;
        }

        .ev-period {
            font-size: 11px;
            font-family: "Inter", "Microsoft YaHei", sans-serif;
            color: #2B579A;
            background-color: #dbeafe;
            padding: 1px 5px;
            border-radius: 4px;
            font-weight: 600;
            letter-spacing: 0.5px;
        }

        .ev-location-separator {
             color: #cbd5e1;
             font-size: 11px;
             margin: 0 2px;
        }

        .ev-location {
            font-size: 13px;
            font-family: "Inter", "Microsoft YaHei", sans-serif;
            color: #333333;
            font-weight: 500;
        }

        .ev-course-name {
            font-size: 14px;
            font-weight: 700;
            color: var(--text-main);
            margin-top: 2px;
            position: relative;
            cursor: pointer;
            line-height: 1.4;
        }

        .ev-tooltip {
            visibility: hidden;
            opacity: 0;
            position: absolute;
            background: #333;
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 400;
            width: max-content;
            max-width: 200px;
            top: 100%;
            left: 0;
            z-index: 1000;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
            transition: opacity 0.2s ease-in-out, visibility 0.2s ease-in-out;
            transition-delay: 0.2s;
            pointer-events: none;
        }

        .ev-course-name:hover .ev-tooltip {
            visibility: visible;
            opacity: 1;
            transition-delay: 0.4s;
        }

        @media (hover: none) {
            .ev-course-name:active .ev-tooltip {
                visibility: visible;
                opacity: 1;
                transition-delay: 0s;
            }
        }

        @media print {
            body { background: white; padding: 0; }
            .month-container { box-shadow: none; border-color: #eee; page-break-inside: avoid; }
        }
    `;

    const getExportLogoDataUrl = async () => {
        const src = 'Logo_yedaoai_Green_Web600.png';
        try {
            const img = new Image();
            img.decoding = 'async';
            img.loading = 'eager';
            img.src = src;

            await new Promise((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('logo_load_failed'));
            });

            const w0 = img.naturalWidth || img.width || 0;
            const h0 = img.naturalHeight || img.height || 0;
            if (!w0 || !h0) return '';

            const targetH = 64;
            const scale = Math.min(1, targetH / h0);
            const w = Math.max(1, Math.round(w0 * scale));
            const h = Math.max(1, Math.round(h0 * scale));

            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;

            const ctx = canvas.getContext('2d');
            if (!ctx) return '';
            ctx.drawImage(img, 0, 0, w, h);

            const dataUrl = canvas.toDataURL('image/png');
            return (dataUrl && dataUrl.startsWith('data:image/')) ? dataUrl : '';
        } catch (_) {
            return '';
        }
    };

    const logoDataUrl = await getExportLogoDataUrl();
    const logoSrc = logoDataUrl || 'Logo_yedaoai_Green_Web600.png';

    const fullHtml = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>我的课表 - ScheduleLLM</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
        ${cssText}
    </style>
</head>
<body>
    <header class="export-header">
        <h1 class="export-title"><img class="export-logo" src="${logoSrc}" alt="YedaoAI" loading="eager" decoding="async" onerror="this.style.display='none';">课程表月历</h1>
        <p>由析课识别生成 · <a class="export-site-link" href="https://yedaoai.com" target="_blank" rel="noopener noreferrer">yedaoai.com</a></p>
    </header>
    <div class="content-wrapper">
        ${container.innerHTML}
    </div>
</body>
</html>
    `;

    // 4. Download
    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `schedule_export.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

function scheduleLLMCloneTemplate(templateId) {
    const tmpl = document.getElementById(templateId);
    if (!tmpl || !(tmpl instanceof HTMLTemplateElement)) return null;
    return tmpl.content.cloneNode(true);
}

function scheduleLLMInitSiteModal() {
    const btnAbout = document.getElementById('btnAboutXike');
    const btnContact = document.getElementById('btnContact');

    const backdrop = document.getElementById('siteModalBackdrop');
    const dialog = backdrop ? backdrop.querySelector('.modal-dialog') : null;
    const titleEl = document.getElementById('siteModalTitle');
    const bodyEl = document.getElementById('siteModalBody');
    const actionsEl = document.getElementById('siteModalActions');
    const closeBtn = document.getElementById('siteModalClose');

    if (!btnAbout || !btnContact || !backdrop || !dialog || !titleEl || !bodyEl || !actionsEl || !closeBtn) return;

    let lastActiveEl = null;
    let closeTimer = null;
    const lockState = {
        bodyOverflow: document.body.style.overflow,
        htmlOverflow: document.documentElement.style.overflow
    };

    const clearCloseTimer = () => {
        if (closeTimer) {
            clearTimeout(closeTimer);
            closeTimer = null;
        }
    };

    const setBodyScrollLocked = (locked) => {
        if (locked) {
            lockState.bodyOverflow = document.body.style.overflow;
            lockState.htmlOverflow = document.documentElement.style.overflow;
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
            return;
        }
        document.body.style.overflow = lockState.bodyOverflow;
        document.documentElement.style.overflow = lockState.htmlOverflow;
    };

    const renderModal = (type) => {
        bodyEl.textContent = '';
        actionsEl.textContent = '';

        if (type === 'about') {
            titleEl.textContent = '关于析课';
            const content = scheduleLLMCloneTemplate('tmplAboutXike');
            if (content) bodyEl.appendChild(content);
            return;
        }

        if (type === 'editor') {
            titleEl.textContent = '核对与编辑';
            const content = scheduleLLMCloneTemplate('tmplCourseEditor');
            if (content) bodyEl.appendChild(content);
            scheduleLLMRenderCourseEditor(bodyEl);
            return;
        }

        if (type === 'contact') {
            titleEl.textContent = '联系我们';
            const content = scheduleLLMCloneTemplate('tmplContact');
            if (content) bodyEl.appendChild(content);

            const email = 'yedaoai@126.com';
            const copyBtn = bodyEl.querySelector('#contactCopyBtn');

            if (copyBtn) {
                copyBtn.addEventListener('click', async () => {
                    const done = () => {
                        copyBtn.classList.add('is-copied');
                        const originalTitle = copyBtn.getAttribute('title');
                        copyBtn.setAttribute('title', '已复制');
                        setTimeout(() => {
                            copyBtn.classList.remove('is-copied');
                            if (originalTitle) copyBtn.setAttribute('title', originalTitle);
                        }, 1200);
                    };

                    try {
                        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                            await navigator.clipboard.writeText(email);
                            done();
                            return;
                        }

                        const ta = document.createElement('textarea');
                        ta.value = email;
                        ta.setAttribute('readonly', '');
                        ta.style.position = 'fixed';
                        ta.style.left = '-9999px';
                        ta.style.top = '0';
                        document.body.appendChild(ta);
                        ta.select();
                        const ok = document.execCommand('copy');
                        ta.remove();
                        if (ok) done();
                    } catch (e) {
                        void e;
                    }
                }, { once: true });
            }
        }
    };

    const isOpen = () => !backdrop.hidden;

    const openModal = (type) => {
        clearCloseTimer();
        lastActiveEl = document.activeElement;
        renderModal(type);
        backdrop.classList.toggle('is-compact', type === 'contact');
        backdrop.hidden = false;
        setBodyScrollLocked(true);
        requestAnimationFrame(() => {
            backdrop.classList.add('is-open');
            closeBtn.focus();
        });
    };

    const closeModal = () => {
        if (!isOpen()) return;
        clearCloseTimer();
        backdrop.classList.remove('is-open');
        backdrop.classList.remove('is-compact');
        setBodyScrollLocked(false);
        closeTimer = setTimeout(() => {
            backdrop.hidden = true;
            if (lastActiveEl && typeof lastActiveEl.focus === 'function') lastActiveEl.focus();
        }, 180);
    };

    if (typeof window !== 'undefined') {
        window.scheduleLLMOpenSiteModal = openModal;
        window.scheduleLLMCloseSiteModal = closeModal;
    }

    btnAbout.addEventListener('click', () => openModal('about'));
    btnContact.addEventListener('click', () => openModal('contact'));

    closeBtn.addEventListener('click', closeModal);

    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
    });

    document.addEventListener('keydown', (e) => {
        if (!isOpen()) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            closeModal();
        }
    });
}

scheduleLLMInitSiteModal();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        scheduleLLMGetConfig,
        scheduleLLMAdjustPlaceholderBox,
        scheduleLLMOnScheduleFileLoaded
    };
}
