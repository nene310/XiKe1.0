(function () {
    const isValidTime = (t) => {
        if (typeof t !== 'string') return false;
        const m = t.match(/^(\d{2}):(\d{2})$/);
        if (!m) return false;
        const h = Number(m[1]);
        const min = Number(m[2]);
        if (!Number.isFinite(h) || !Number.isFinite(min)) return false;
        if (h < 0 || h > 23) return false;
        if (min < 0 || min > 59) return false;
        return true;
    };

    const parseTimeToMinutes = (t) => {
        if (!isValidTime(t)) return null;
        const parts = t.split(':');
        const h = Number(parts[0]);
        const m = Number(parts[1]);
        return h * 60 + m;
    };

    const formatMinutes = (m) => {
        if (!Number.isFinite(m)) return null;
        if (m < 0 || m >= 24 * 60) return null;
        const h = Math.floor(m / 60);
        const mm = m % 60;
        return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    };

    const addMinutesToTime = (t, delta) => {
        const base = parseTimeToMinutes(t);
        if (base === null || !Number.isFinite(delta)) return null;
        return formatMinutes(base + delta);
    };

    const diffTimeMinutes = (from, to) => {
        const a = parseTimeToMinutes(from);
        const b = parseTimeToMinutes(to);
        if (a === null || b === null) return null;
        return b - a;
    };

    const shiftSlots = (slots, indices, delta) => {
        if (!Array.isArray(slots)) return { ok: false, message: '时间设置无效' };
        const next = slots.map(s => ({ start: s.start, end: s.end }));
        for (const idx of indices) {
            if (!Number.isFinite(idx) || idx < 0 || idx >= next.length) {
                return { ok: false, message: '节次索引无效' };
            }
            const start = addMinutesToTime(next[idx].start, delta);
            const end = addMinutesToTime(next[idx].end, delta);
            if (!start || !end) return { ok: false, message: '时间超出范围' };
            next[idx] = { start, end };
        }
        return { ok: true, slots: next };
    };

    const validateSlots = (slots) => {
        if (!Array.isArray(slots) || slots.length === 0) {
            return { ok: false, message: '时间设置无效' };
        }
        for (let i = 0; i < slots.length; i++) {
            const s = slots[i];
            if (!s || !isValidTime(s.start) || !isValidTime(s.end)) {
                return { ok: false, message: `第${i + 1}节时间格式不正确` };
            }
            const sm = parseTimeToMinutes(s.start);
            const em = parseTimeToMinutes(s.end);
            if (sm >= em) {
                return { ok: false, message: `第${i + 1}节开始时间必须早于结束时间` };
            }
        }
        for (let i = 0; i < slots.length - 1; i++) {
            const curEnd = parseTimeToMinutes(slots[i].end);
            const nextStart = parseTimeToMinutes(slots[i + 1].start);
            if (curEnd > nextStart) {
                return { ok: false, message: `第${i + 1}节与第${i + 2}节时间冲突` };
            }
        }
        return { ok: true };
    };

    const computeShiftedSlots = (baseSlots, idx, type, newValue, opts) => {
        if (!Array.isArray(baseSlots) || baseSlots.length === 0) {
            return { ok: false, message: '时间设置无效' };
        }
        if (!Number.isFinite(idx) || idx < 0 || idx >= baseSlots.length) {
            return { ok: false, message: '节次索引无效' };
        }
        if (type !== 'start' && type !== 'end') {
            return { ok: false, message: '时间字段无效' };
        }
        if (!isValidTime(newValue)) {
            return { ok: false, message: '时间格式不正确' };
        }

        const firstDuration = opts && Number.isFinite(opts.firstDuration) ? Number(opts.firstDuration) : 45;
        const maxIndex = opts && Number.isFinite(opts.maxIndex) ? Number(opts.maxIndex) : baseSlots.length - 1;
        const mins = baseSlots.map((slot, i) => {
            if (!slot || !isValidTime(slot.start) || !isValidTime(slot.end)) return null;
            const start = parseTimeToMinutes(slot.start);
            const end = parseTimeToMinutes(slot.end);
            if (start === null || end === null) return null;
            return { start, end, i };
        });

        if (mins.some(m => !m)) return { ok: false, message: '时间设置无效' };

        const next = mins.map(m => ({ start: m.start, end: m.end }));
        const newMin = parseTimeToMinutes(newValue);

        if (type === 'start') {
            const duration = idx === 0 ? firstDuration : (mins[idx].end - mins[idx].start);
            if (!Number.isFinite(duration) || duration <= 0) {
                return { ok: false, message: '课程时长无效' };
            }
            const newEnd = newMin + duration;
            if (newEnd <= newMin || newEnd >= 24 * 60) {
                return { ok: false, message: '时间超出范围' };
            }
            next[idx] = { start: newMin, end: newEnd };
        } else {
            const start = mins[idx].start;
            if (newMin <= start || newMin >= 24 * 60) {
                return { ok: false, message: '结束时间无效' };
            }
            next[idx] = { start, end: newMin };
        }

        for (let i = idx + 1; i < mins.length && i <= maxIndex; i++) {
            const gap = mins[i].start - mins[i - 1].end;
            if (!Number.isFinite(gap)) return { ok: false, message: '课间设置无效' };
            const duration = mins[i].end - mins[i].start;
            if (!Number.isFinite(duration) || duration <= 0) {
                return { ok: false, message: '课程时长无效' };
            }
            const newStart = next[i - 1].end + gap;
            const newEnd = newStart + duration;
            if (newStart < 0 || newEnd >= 24 * 60) {
                return { ok: false, message: '时间超出范围' };
            }
            next[i] = { start: newStart, end: newEnd };
        }

        const slots = next.map(s => ({ start: formatMinutes(s.start), end: formatMinutes(s.end) }));
        const validation = validateSlots(slots);
        if (!validation.ok) return validation;
        return { ok: true, slots };
    };

    const sanitizePeriodRange = (periodRange) => {
        if (!periodRange) return '';

        const raw = String(periodRange).trim();
        if (!raw) return '';

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

        const toP = (n) => {
            const v = parseInt(n, 10);
            if (!Number.isFinite(v)) return 1;
            return v >= 1 ? v : 1;
        };

        const normParts = parts.map(part => {
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
    };

    const normalizeOCRText = (str) => {
        if (!str) return '';
        return String(str)
            .replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 65248))
            .replace(/[Ａ-Ｚａ-ｚ]/g, s => String.fromCharCode(s.charCodeAt(0) - 65248))
            .replace(/（/g, '(').replace(/）/g, ')')
            .replace(/：/g, ':')
            .replace(/[—－]/g, '-')
            .replace(/[~～—–−]/g, '-')
            .replace(/(\d+)\s*[\n\r]*[-~～]\s*[\n\r]*\s*(\d+)/g, '$1-$2')
            .replace(/(\d+)\s*[\n\r]+\s*(\d+)/g, '$1$2')
            .trim();
    };

    const editDistance = (a, b) => {
        const s = String(a == null ? '' : a);
        const t = String(b == null ? '' : b);
        const n = s.length;
        const m = t.length;
        if (n === 0) return m;
        if (m === 0) return n;

        const dp = new Array(m + 1);
        for (let j = 0; j <= m; j++) dp[j] = j;

        for (let i = 1; i <= n; i++) {
            let prev = dp[0];
            dp[0] = i;
            for (let j = 1; j <= m; j++) {
                const tmp = dp[j];
                const cost = s[i - 1] === t[j - 1] ? 0 : 1;
                dp[j] = Math.min(
                    dp[j] + 1,
                    dp[j - 1] + 1,
                    prev + cost
                );
                prev = tmp;
            }
        }
        return dp[m];
    };

    const normalizeWeekParityToken = (raw) => {
        const t0 = String(raw || '').replace(/[()（）\s]/g, '');
        if (!t0) return null;

        if (/[单双]/.test(t0)) return t0.includes('双') ? '双' : '单';
        if (/奇/.test(t0)) return '单';
        if (/偶/.test(t0)) return '双';

        if (/^(?:单周|奇周)$/i.test(t0)) return '单';
        if (/^(?:双周|偶周)$/i.test(t0)) return '双';

        if (/^[1一I|l]+$/.test(t0)) return '单';
        if (/^[2二Zz]+$/.test(t0)) return '双';

        if (t0 === '旦' || t0 === '早' || t0 === '甲') return '单';
        if (t0 === '又' || t0 === '叉' || t0 === '对') return '双';

        if (/^[xX×✕✖]{2,}$/.test(t0)) return '双';
        if (t0 === 'XX' || t0 === 'xx') return '双';

        if (/^[单双奇偶旦又叉对甲早xX×✕✖1I|l一二2Zz]{1,4}$/.test(t0)) {
            const candidates = [
                { k: '单', v: '单' },
                { k: '双', v: '双' },
                { k: '奇', v: '单' },
                { k: '偶', v: '双' },
                { k: '单周', v: '单' },
                { k: '双周', v: '双' },
                { k: '奇周', v: '单' },
                { k: '偶周', v: '双' }
            ];
            let best = null;
            for (const c of candidates) {
                const d = editDistance(t0, c.k);
                if (!best || d < best.d) best = { d, v: c.v };
            }
            if (best && best.d <= 1) return best.v;
        }

        return null;
    };

    const parseWeekString = (str, opts) => {
        if (!str) return [];

        const maxWeek = (opts && Number.isFinite(opts.maxWeek)) ? Number(opts.maxWeek) : 30;

        let cleanStr = normalizeOCRText(str);
        cleanStr = cleanStr.replace(/\([^)]*节\)/g, '');

        cleanStr = cleanStr
            .replace(/(\d+(?:\s*[-~～—–−]\s*\d+)?)\s*周\s*([^\d,，()（）\s]{1,4})(?=[,，\s]|$)/g, '$1周($2)')
            .replace(/(\d+(?:\s*[-~～—–−]\s*\d+)?)\s*周\s*(单|双)(?=[,，\s]|$)/g, '$1周($2)')
            .replace(/(\d+(?:\s*[-~～—–−]\s*\d+)?)\s*(单周|双周|奇周|偶周)(?=[,，\s]|$)/g, (_, a, b) => {
                const p = normalizeWeekParityToken(b);
                return p ? `${a}周(${p})` : `${a}周`;
            });

        const parts = cleanStr.split(/[,，]/);
        const weekSet = new Set();

        for (const part0 of parts) {
            const part = String(part0 || '');
            const weekRe = /(\d+)(?:\s*[-~～—–−]\s*(\d+))?(?:周|W|w)?(?:\s*[\(（]\s*([^\)）]{1,8})\s*[\)）])?/g;
            let match;
            while ((match = weekRe.exec(part)) !== null) {
                if (!match[0]) continue;

                const token = match[0];
                const hasWeekMark = /[周Ww]/.test(token);
                const hasRange = !!match[2];
                if (!hasWeekMark && !hasRange) continue;

                const start = parseInt(match[1], 10);
                const end = match[2] ? parseInt(match[2], 10) : start;
                if (!Number.isFinite(start) || start <= 0 || start > maxWeek) continue;
                if (!Number.isFinite(end) || end <= 0 || end > maxWeek) continue;

                const parity = normalizeWeekParityToken(match[3]);

                for (let i = start; i <= end; i++) {
                    if (parity === '单' && i % 2 === 0) continue;
                    if (parity === '双' && i % 2 !== 0) continue;
                    weekSet.add(i);
                }
            }
        }

        return Array.from(weekSet).sort((a, b) => a - b);
    };

    const formatWeekRanges = (weeks) => {
        if (!Array.isArray(weeks) || weeks.length === 0) return '';
        const uniqueWeeks = Array.from(new Set(weeks)).filter(n => Number.isFinite(n)).sort((a, b) => a - b);
        if (uniqueWeeks.length === 0) return '';

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
    };

    const formatClassAndWeeksLines = (classNames, weeks) => {
        const names = Array.isArray(classNames) ? classNames : (classNames ? [classNames] : []);
        const cleanNames = names
            .filter(n => n)
            .map(n => String(n).replace(/^[\(（]/, '').replace(/[\)）]$/, ''))
            .filter(Boolean);

        const dedup = [];
        for (const n of cleanNames) {
            if (!dedup.includes(n)) dedup.push(n);
        }

        const classText = dedup.length > 0 ? dedup.join('/') : '';
        const weeksText = formatWeekRanges(weeks);

        const lines = [];
        if (classText) lines.push(classText);
        if (weeksText) lines.push(weeksText);

        return { classText, weeksText, lines };
    };

    const icsEscapeText = (val) => {
        if (val == null) return '';
        return String(val)
            .replace(/\\/g, '\\\\')
            .replace(/\r\n|\r|\n/g, '\\n')
            .replace(/;/g, '\\;')
            .replace(/,/g, '\\,');
    };

    const icsFoldLine = (line, limitBytes) => {
        const limit = Number.isFinite(limitBytes) ? Number(limitBytes) : 75;
        const s = String(line == null ? '' : line);
        if (!s) return '';

        const enc = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
        const byteLen = (str) => {
            if (enc) return enc.encode(str).length;
            if (typeof Buffer !== 'undefined') return Buffer.byteLength(str, 'utf8');
            return unescape(encodeURIComponent(str)).length;
        };

        if (byteLen(s) <= limit) return s;

        let out = '';
        let cur = '';

        for (const ch of s) {
            const next = cur + ch;
            if (byteLen(next) > limit) {
                if (out) out += '\r\n ';
                out += cur;
                cur = ch;
            } else {
                cur = next;
            }
        }

        if (cur) {
            if (out) out += '\r\n ';
            out += cur;
        }

        return out;
    };

    const getPeriodBounds = (periodRange, fallbackPeriod, opts) => {
        const maxPeriod = (opts && Number.isFinite(opts.maxPeriod)) ? Number(opts.maxPeriod) : 20;

        const toP = (n) => {
            const v = parseInt(n, 10);
            if (!Number.isFinite(v)) return null;
            if (v <= 0) return null;
            if (v > maxPeriod) return null;
            return v;
        };

        const raw = periodRange == null ? '' : String(periodRange);
        const norm = sanitizePeriodRange(raw);
        const s = norm ? String(norm) : '';

        const nums = [];
        if (s) {
            const parts = s.split(',').map(x => x.trim()).filter(Boolean);
            for (const part of parts) {
                const mRange = part.match(/^(\d+)\s*-\s*(\d+)$/);
                if (mRange) {
                    const a = toP(mRange[1]);
                    const b = toP(mRange[2]);
                    if (a != null) nums.push(a);
                    if (b != null) nums.push(b);
                    continue;
                }
                const mSingle = part.match(/^(\d+)$/);
                if (mSingle) {
                    const a = toP(mSingle[1]);
                    if (a != null) nums.push(a);
                }
            }
        }

        if (nums.length === 0) {
            const fb = toP(fallbackPeriod);
            if (fb == null) return null;
            return { start: fb, end: fb };
        }

        let start = nums[0];
        let end = nums[0];
        for (const n of nums) {
            if (n < start) start = n;
            if (n > end) end = n;
        }
        if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
        if (end < start) end = start;
        return { start, end };
    };

    const getTimeRangeForPeriod = (slots, periodRange, fallbackPeriod) => {
        if (!Array.isArray(slots) || slots.length === 0) return null;

        const bounds = getPeriodBounds(periodRange, fallbackPeriod, { maxPeriod: slots.length });
        if (!bounds) return null;

        const startSlot = slots[bounds.start - 1];
        const endSlot = slots[bounds.end - 1];
        if (!startSlot || !endSlot) return null;

        const startTime = startSlot.start;
        const endTime = endSlot.end;
        if (!isValidTime(startTime) || !isValidTime(endTime)) return null;

        return {
            startPeriod: bounds.start,
            endPeriod: bounds.end,
            startTime,
            endTime
        };
    };

    const api = {
        isValidTime,
        parseTimeToMinutes,
        formatMinutes,
        addMinutesToTime,
        diffTimeMinutes,
        shiftSlots,
        validateSlots,
        computeShiftedSlots,
        sanitizePeriodRange,
        normalizeWeekParityToken,
        parseWeekString,
        formatWeekRanges,
        formatClassAndWeeksLines,
        icsEscapeText,
        icsFoldLine,
        getPeriodBounds,
        getTimeRangeForPeriod
    };

    if (typeof window !== 'undefined') {
        window.ScheduleLLMTimeUtils = api;
    }
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();