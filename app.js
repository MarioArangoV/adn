/* ===================================================
   ADN Brand Visualizer — app.js
   Pure JS, no dependencies, reads data/*.json
   =================================================== */

(function () {
    'use strict';

    // ────────────────────── STATE ──────────────────────
    const state = {
        brands: [],
        filtered: [],
        compareSet: new Set(),     // brand names
        activeView: 'explorer',
        activeFilters: {},         // { field: Set([val]) }
        searchQuery: '',
        hideUnknown: false,
        selectedBrand: null,
        activeDrawerTab: 'essence'
    };

    // ────────────────────── TAXONOMY LABELS / TOOLTIPS ──────────────────────
    const TOOLTIPS = {
        early_adopter: 'Adopta tendencias antes que la mayoría del mercado',
        mid_adopter: 'Adopta tendencias cuando ya están validadas',
        late_adopter: 'Adopta tendencias en fase madura',
        selective_adopter: 'Solo adopta tendencias compatibles con su ADN',
        anti_trend: 'Ignora o rechaza tendencias deliberadamente',
        dtc: 'Directo al consumidor (Direct-to-Consumer)',
        wholesale: 'Venta al por mayor',
        marketplace_first: 'Presencia principal en marketplaces',
        impulso: 'Compra por impulso, sin mucha consideración',
        considerada: 'Compra pensada, se compara',
        inversion: 'Compra como inversión a largo plazo'
    };

    const LABEL_MAP = {
        desconocido: 'Desconocido', entry: 'Entry', masivo: 'Masivo', medio: 'Medio',
        premium: 'Premium', lujo: 'Lujo', ultra_lujo: 'Ultra Lujo',
        mujer: 'Mujer', hombre: 'Hombre', unisex: 'Unisex', ninos: 'Niños',
        bebe: 'Bebé', familiar: 'Familiar'
    };

    const STYLE_COLORS = {
        minimalista: '#6366f1', clasico: '#8b5cf6', contemporaneo: '#06b6d4',
        streetwear: '#f59e0b', workwear: '#84cc16', athleisure: '#22c55e',
        formal_tailoring: '#475569', romantico: '#ec4899', boho: '#f97316',
        preppy: '#14b8a6', avant_garde: '#ef4444', heritage_vintage: '#a16207',
        outdoor_utility: '#65a30d', resort: '#0ea5e9', y2k: '#d946ef',
        punk_grunge: '#dc2626', artesanal: '#b45309', modest: '#64748b',
        desconocido: '#9ca3af'
    };

    // ────────────────────── FILTER CONFIG ──────────────────────
    const FILTER_DEFS = [
        { key: 'price_segment', label: 'Segmento de precio', path: 'dna.positioning.price_segment' },
        { key: 'style_primary', label: 'Estilo principal', path: 'dna.style.style_primary' },
        { key: 'gender_focus', label: 'Género', path: 'dna.audience.gender_focus' },
        { key: 'archetype_primary', label: 'Arquetipo', path: 'dna.essence.archetype_primary' },
        { key: 'business_model', label: 'Modelo de negocio', path: 'dna.operations.business_model' },
        { key: 'channels', label: 'Canales', path: 'dna.operations.channels', multi: true },
        { key: 'geography', label: 'Geografía', path: 'dna.operations.geography' },
        { key: 'promo_dependency', label: 'Dep. promocional', path: 'dna.positioning.promo_dependency' },
        { key: 'trend_adoption_type', label: 'Adopción tendencias', path: 'dna.trend_behavior.trend_adoption_type' },
        { key: 'occasion_focus', label: 'Ocasión', path: 'dna.product.occasion_focus', multi: true },
        { key: 'identity_categories', label: 'Categorías identidad', path: 'dna.product.identity_categories', multi: true }
    ];

    // ────────────────────── DATA LOADING ──────────────────────
    async function loadBrands() {
        // Fetch the file list from a known manifest, or try to load known files
        // Since we can't list directories from static JS, we use a simple approach:
        // Try to load a manifest, or fallback to scanning known filenames.
        const brands = [];
        try {
            // Try manifest first
            const manifestResp = await fetch('data/manifest.json');
            if (manifestResp.ok) {
                const manifest = await manifestResp.json();
                const promises = manifest.map(f => fetch(`data/${f}`).then(r => r.ok ? r.json() : null));
                const results = await Promise.all(promises);
                results.forEach(b => b && brands.push(b));
            } else {
                throw new Error('no manifest');
            }
        } catch {
            // Fallback: try known files — in production generate manifest
            const knownFiles = ['color_blue.json', 'gef.json', 'stop.json'];
            // Also try to discover more by brute-force fetch (up to 100)
            const allFiles = [...knownFiles];
            const promises = allFiles.map(f =>
                fetch(`data/${f}`).then(r => r.ok ? r.json() : null).catch(() => null)
            );
            const results = await Promise.all(promises);
            results.forEach(b => b && brands.push(b));
        }
        return brands;
    }

    // ────────────────────── HELPERS ──────────────────────
    function getNestedValue(obj, path) {
        return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : undefined), obj);
    }

    function capitalize(s) {
        if (!s) return '';
        return LABEL_MAP[s] || s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }

    function globalConfidence(brand) {
        const blocks = ['essence', 'audience', 'product', 'style', 'positioning', 'operations', 'trend_behavior'];
        let sum = 0, count = 0;
        blocks.forEach(b => {
            const c = brand.dna?.[b]?.confidence;
            if (c !== undefined) { sum += c; count++; }
        });
        return count ? sum / count : 0;
    }

    function dataQualityLabel(conf) {
        if (conf >= 0.75) return 'Completo';
        if (conf >= 0.5) return 'Medio';
        return 'Bajo';
    }

    function confClass(conf) {
        if (conf >= 0.75) return 'high';
        if (conf >= 0.5) return 'mid';
        return 'low';
    }

    // ────────────────────── SIMILARITY ──────────────────────
    function jaccardSimilarity(setA, setB) {
        if (!setA || !setB || (!setA.length && !setB.length)) return 0;
        const a = new Set(Array.isArray(setA) ? setA : [setA]);
        const b = new Set(Array.isArray(setB) ? setB : [setB]);
        const intersection = [...a].filter(x => b.has(x)).length;
        const union = new Set([...a, ...b]).size;
        return union ? intersection / union : 0;
    }

    function brandSimilarity(a, b) {
        const w = { style: .25, price: .15, gender: .1, identity: .2, trend: .1, model: .1, channels: .1 };
        let score = 0;

        // Style
        const stylesA = [a.dna?.style?.style_primary, ...(a.dna?.style?.style_secondary || [])].filter(Boolean);
        const stylesB = [b.dna?.style?.style_primary, ...(b.dna?.style?.style_secondary || [])].filter(Boolean);
        score += w.style * jaccardSimilarity(stylesA, stylesB);

        // Price
        score += w.price * (a.dna?.positioning?.price_segment === b.dna?.positioning?.price_segment ? 1 : 0);

        // Gender
        score += w.gender * (a.dna?.audience?.gender_focus === b.dna?.audience?.gender_focus ? 1 : 0);

        // Identity categories
        score += w.identity * jaccardSimilarity(
            a.dna?.product?.identity_categories,
            b.dna?.product?.identity_categories
        );

        // Trend adoption
        score += w.trend * (a.dna?.trend_behavior?.trend_adoption_type === b.dna?.trend_behavior?.trend_adoption_type ? 1 : 0);

        // Business model
        score += w.model * (a.dna?.operations?.business_model === b.dna?.operations?.business_model ? 1 : 0);

        // Channels
        score += w.channels * jaccardSimilarity(
            a.dna?.operations?.channels,
            b.dna?.operations?.channels
        );

        return score;
    }

    function getTopSimilar(brand, allBrands, top = 5) {
        return allBrands
            .filter(b => b.brand.name !== brand.brand.name)
            .map(b => ({ brand: b, score: brandSimilarity(brand, b) }))
            .sort((a, b) => b.score - a.score)
            .slice(0, top);
    }

    // ────────────────────── FILTERING ──────────────────────
    function applyFilters() {
        let result = state.brands;

        // Search
        if (state.searchQuery) {
            const q = state.searchQuery.toLowerCase();
            result = result.filter(b => b.brand.name.toLowerCase().includes(q));
        }

        // Hide unknown
        if (state.hideUnknown) {
            result = result.filter(b => globalConfidence(b) >= 0.5);
        }

        // Faceted filters
        for (const [key, values] of Object.entries(state.activeFilters)) {
            if (!values.size) continue;
            const def = FILTER_DEFS.find(d => d.key === key);
            if (!def) continue;
            result = result.filter(b => {
                const val = getNestedValue(b, def.path);
                if (Array.isArray(val)) {
                    return val.some(v => values.has(v));
                }
                return values.has(val);
            });
        }

        state.filtered = result;
        renderCards();
        updateCounter();
    }

    // ────────────────────── RENDER: FILTERS ──────────────────────
    function renderFilters() {
        const container = document.getElementById('filterContainer');
        container.innerHTML = '';

        FILTER_DEFS.forEach(def => {
            const counts = {};
            state.brands.forEach(b => {
                const val = getNestedValue(b, def.path);
                if (Array.isArray(val)) {
                    val.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
                } else if (val) {
                    counts[val] = (counts[val] || 0) + 1;
                }
            });

            if (!Object.keys(counts).length) return;

            const group = document.createElement('div');
            group.className = 'filter-group';
            group.innerHTML = `<div class="filter-group__title">${def.label}</div>`;

            const opts = document.createElement('div');
            opts.className = 'filter-group__options';

            Object.entries(counts)
                .sort((a, b) => b[1] - a[1])
                .forEach(([val, count]) => {
                    const chip = document.createElement('button');
                    chip.className = 'chip';
                    const isActive = state.activeFilters[def.key]?.has(val);
                    if (isActive) chip.classList.add('active');
                    chip.innerHTML = `${capitalize(val)} <span class="chip__count">(${count})</span>`;
                    if (TOOLTIPS[val]) chip.setAttribute('data-tooltip', TOOLTIPS[val]);

                    chip.addEventListener('click', () => {
                        if (!state.activeFilters[def.key]) state.activeFilters[def.key] = new Set();
                        if (state.activeFilters[def.key].has(val)) {
                            state.activeFilters[def.key].delete(val);
                        } else {
                            state.activeFilters[def.key].add(val);
                        }
                        renderFilters();
                        applyFilters();
                    });

                    opts.appendChild(chip);
                });

            group.appendChild(opts);
            container.appendChild(group);
        });
    }

    // ────────────────────── RENDER: CARDS ──────────────────────
    function renderCards() {
        const grid = document.getElementById('cardGrid');
        grid.innerHTML = '';

        if (!state.filtered.length) {
            grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:60px;color:var(--c-text-muted)"><h3>Sin resultados</h3><p>Ajusta los filtros o la búsqueda</p></div>';
            return;
        }

        state.filtered.forEach(brand => {
            const card = document.createElement('div');
            card.className = 'brand-card';

            const conf = globalConfidence(brand);
            const quality = dataQualityLabel(conf);
            const dna = brand.dna;

            // Identity categories (max 3 + more)
            const idCats = dna?.product?.identity_categories || [];
            const visibleCats = idCats.slice(0, 3);
            const moreCats = idCats.length - 3;

            // DNA strip blocks
            const blocks = ['essence', 'audience', 'product', 'style', 'positioning', 'operations'];
            const stripHTML = blocks.map(b => {
                const c = dna?.[b]?.confidence || 0;
                return `<div class="dna-strip__block" data-conf="${c}" data-tooltip="${capitalize(b)}: ${Math.round(c * 100)}%" style="--conf:${c}"><div style="position:absolute;left:0;top:0;bottom:0;width:${c * 100}%;border-radius:3px;background:var(--c-primary);opacity:${0.3 + c * 0.7}"></div></div>`;
            }).join('');

            const isCompared = state.compareSet.has(brand.brand.name);

            card.innerHTML = `
                <div class="brand-card__header">
                    <div>
                        <div class="brand-card__name">${brand.brand.name}</div>
                        <div class="brand-card__country">${brand.brand.country || ''}</div>
                    </div>
                </div>
                <div class="brand-card__badges">
                    <span class="badge badge--price">${capitalize(dna?.positioning?.price_segment)}</span>
                    <span class="badge badge--style">${capitalize(dna?.style?.style_primary)}</span>
                    <span class="badge badge--gender">${capitalize(dna?.audience?.gender_focus)}</span>
                    <span class="badge badge--archetype">${capitalize(dna?.essence?.archetype_primary)}</span>
                    <span class="badge badge--trend" ${TOOLTIPS[dna?.trend_behavior?.trend_adoption_type] ? `data-tooltip="${TOOLTIPS[dna?.trend_behavior?.trend_adoption_type]}"` : ''}>${capitalize(dna?.trend_behavior?.trend_adoption_type)}</span>
                </div>
                <div class="brand-card__chips">
                    ${visibleCats.map(c => `<span class="chip" style="cursor:default">${capitalize(c)}</span>`).join('')}
                    ${moreCats > 0 ? `<span class="chip chip--more">+${moreCats}</span>` : ''}
                </div>
                <div class="dna-strip">${stripHTML}</div>
                <div class="confidence-bar">
                    <div class="confidence-bar__fill confidence-bar__fill--${confClass(conf)}" style="width:${conf * 100}%"></div>
                </div>
                <div class="brand-card__footer">
                    <span class="brand-card__quality">Data: ${quality} (${Math.round(conf * 100)}%)</span>
                    <div class="brand-card__actions">
                        <button class="btn btn--sm btn--compare ${isCompared ? 'active' : ''}" data-compare="${brand.brand.name}">
                            ${isCompared ? '✓ Añadida' : '+ Comparar'}
                        </button>
                    </div>
                </div>
            `;

            // Click card → open drawer
            card.addEventListener('click', (e) => {
                if (e.target.closest('[data-compare]')) return;
                openDrawer(brand);
            });

            // Compare button
            const compareBtn = card.querySelector('[data-compare]');
            compareBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleCompare(brand.brand.name);
            });

            grid.appendChild(card);
        });
    }

    function updateCounter() {
        document.getElementById('brandCounter').textContent = `${state.filtered.length} marca${state.filtered.length !== 1 ? 's' : ''}`;
    }

    // ────────────────────── COMPARE ──────────────────────
    function toggleCompare(name) {
        if (state.compareSet.has(name)) {
            state.compareSet.delete(name);
        } else {
            if (state.compareSet.size >= 6) return; // max 6
            state.compareSet.add(name);
        }
        renderCards();
        updateCompareTray();
    }

    function updateCompareTray() {
        const tray = document.getElementById('compareTray');
        const brandsEl = document.getElementById('compareTrayBrands');
        const countEl = document.getElementById('compareTrayCount');

        if (state.compareSet.size === 0) {
            tray.style.display = 'none';
            return;
        }

        tray.style.display = 'flex';
        countEl.textContent = state.compareSet.size;

        brandsEl.innerHTML = '';
        state.compareSet.forEach(name => {
            const chip = document.createElement('span');
            chip.className = 'compare-tray__chip';
            chip.innerHTML = `${name} <button data-remove="${name}">&times;</button>`;
            chip.querySelector('button').addEventListener('click', () => toggleCompare(name));
            brandsEl.appendChild(chip);
        });
    }

    function renderCompare() {
        const empty = document.getElementById('compareEmpty');
        const content = document.getElementById('compareContent');

        if (state.compareSet.size < 2) {
            empty.style.display = 'flex';
            content.style.display = 'none';
            return;
        }

        empty.style.display = 'none';
        content.style.display = 'flex';

        const brands = state.brands.filter(b => state.compareSet.has(b.brand.name));

        // ── Table ──
        const rows = [
            { label: 'Segmento precio', path: 'dna.positioning.price_segment' },
            { label: 'Estilo principal', path: 'dna.style.style_primary' },
            { label: 'Estilo secundario', path: 'dna.style.style_secondary', array: true },
            { label: 'Género', path: 'dna.audience.gender_focus' },
            { label: 'Arquetipo', path: 'dna.essence.archetype_primary' },
            { label: 'Categorías identidad', path: 'dna.product.identity_categories', array: true },
            { label: 'Fit preferido', path: 'dna.style.fit_preference' },
            { label: 'Visibilidad branding', path: 'dna.style.branding_visibility' },
            { label: 'Dep. promocional', path: 'dna.positioning.promo_dependency' },
            { label: 'Adopción tendencias', path: 'dna.trend_behavior.trend_adoption_type' },
            { label: 'Modelo negocio', path: 'dna.operations.business_model' },
            { label: 'Canales', path: 'dna.operations.channels', array: true },
            { label: 'Riesgo creativo', path: 'dna.essence.creative_risk_level' },
            { label: 'Tolerancia novedad', path: 'dna.essence.novelty_tolerance', numeric: true },
            { label: 'Confidence global', path: null, fn: b => Math.round(globalConfidence(b) * 100) + '%' }
        ];

        let tableHTML = '<thead><tr><th></th>';
        brands.forEach(b => { tableHTML += `<th>${b.brand.name}</th>`; });
        tableHTML += '</tr></thead><tbody>';

        rows.forEach(row => {
            const vals = brands.map(b => {
                if (row.fn) return row.fn(b);
                const v = getNestedValue(b, row.path);
                if (row.array && Array.isArray(v)) return v.map(capitalize).join(', ');
                if (row.numeric) return v !== undefined ? v : '—';
                return v ? capitalize(v) : '—';
            });

            // Check if all same
            const allSame = vals.every(v => v === vals[0]);

            tableHTML += '<tr>';
            tableHTML += `<td>${row.label}</td>`;
            vals.forEach(v => {
                tableHTML += `<td class="${allSame ? 'same' : 'diff'}">${v}</td>`;
            });
            tableHTML += '</tr>';
        });

        tableHTML += '</tbody>';
        document.getElementById('compareTable').innerHTML = tableHTML;

        // ── Radar ──
        renderRadar(brands);
    }

    function renderRadar(brands) {
        const canvas = document.getElementById('radarCanvas');
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        const cx = W / 2, cy = H / 2;
        const R = Math.min(W, H) / 2 - 60;

        ctx.clearRect(0, 0, W, H);

        const axes = [
            { label: 'Riesgo creativo', fn: b => ({ bajo: .25, medio: .5, alto: .85, desconocido: 0 }[b.dna?.essence?.creative_risk_level] || 0) },
            { label: 'Tolerancia novedad', fn: b => b.dna?.essence?.novelty_tolerance || 0 },
            { label: 'Dep. promo (inv)', fn: b => 1 - ({ nula: 0, baja: .25, media: .5, alta: .75, desconocida: .5 }[b.dna?.positioning?.promo_dependency] || .5) },
            { label: 'Precio', fn: b => ({ entry: .1, masivo: .25, medio: .5, premium: .75, lujo: .9, ultra_lujo: 1, desconocido: 0 }[b.dna?.positioning?.price_segment] || 0) },
            { label: 'Confidence', fn: b => globalConfidence(b) }
        ];

        const n = axes.length;
        const angleStep = (2 * Math.PI) / n;

        // Draw grid
        ctx.strokeStyle = '#e5e7eb';
        ctx.lineWidth = 1;
        for (let level = 1; level <= 4; level++) {
            const r = (R / 4) * level;
            ctx.beginPath();
            for (let i = 0; i <= n; i++) {
                const angle = -Math.PI / 2 + i * angleStep;
                const x = cx + r * Math.cos(angle);
                const y = cy + r * Math.sin(angle);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            }
            ctx.closePath();
            ctx.stroke();
        }

        // Draw axes labels
        ctx.fillStyle = '#6b7280';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        axes.forEach((axis, i) => {
            const angle = -Math.PI / 2 + i * angleStep;
            const x = cx + (R + 30) * Math.cos(angle);
            const y = cy + (R + 30) * Math.sin(angle);
            ctx.fillText(axis.label, x, y + 4);
        });

        // Draw brand polygons
        const colors = ['#4f46e5', '#06b6d4', '#f59e0b', '#ef4444', '#22c55e', '#8b5cf6'];
        brands.forEach((brand, bi) => {
            const color = colors[bi % colors.length];
            ctx.strokeStyle = color;
            ctx.fillStyle = color + '22';
            ctx.lineWidth = 2;
            ctx.beginPath();

            axes.forEach((axis, i) => {
                const val = axis.fn(brand);
                const angle = -Math.PI / 2 + i * angleStep;
                const x = cx + R * val * Math.cos(angle);
                const y = cy + R * val * Math.sin(angle);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });

            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Dots
            axes.forEach((axis, i) => {
                const val = axis.fn(brand);
                const angle = -Math.PI / 2 + i * angleStep;
                const x = cx + R * val * Math.cos(angle);
                const y = cy + R * val * Math.sin(angle);
                ctx.beginPath();
                ctx.arc(x, y, 4, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();
            });
        });

        // Legend
        ctx.textAlign = 'left';
        brands.forEach((brand, bi) => {
            const color = colors[bi % colors.length];
            ctx.fillStyle = color;
            ctx.fillRect(10, 10 + bi * 20, 12, 12);
            ctx.fillStyle = '#374151';
            ctx.font = '12px Inter, sans-serif';
            ctx.fillText(brand.brand.name, 28, 20 + bi * 20);
        });
    }

    // ────────────────────── LANDSCAPE (SCATTER) ──────────────────────
    function renderLandscape() {
        const canvas = document.getElementById('scatterCanvas');
        const ctx = canvas.getContext('2d');
        const W = canvas.width, H = canvas.height;
        const pad = { top: 40, right: 40, bottom: 50, left: 60 };
        const plotW = W - pad.left - pad.right;
        const plotH = H - pad.top - pad.bottom;

        ctx.clearRect(0, 0, W, H);

        const priceOrd = { entry: 1, masivo: 2, medio: 3, premium: 4, lujo: 5, ultra_lujo: 6, desconocido: 0 };
        const promoOrd = { nula: 0, baja: .25, media: .5, alta: .75, desconocida: .5 };

        const points = state.brands.map(b => {
            const pSeg = b.dna?.positioning?.price_segment || 'desconocido';
            const pZone = b.dna?.positioning?.price_zone;
            let x = pZone?.p50 ? pZone.p50 : (priceOrd[pSeg] || 0);
            let y = b.dna?.essence?.novelty_tolerance || 0;
            let r = 6 + (promoOrd[b.dna?.positioning?.promo_dependency] || .5) * 14;
            let color = STYLE_COLORS[b.dna?.style?.style_primary] || '#9ca3af';
            return { brand: b, x, y, r, color, label: b.brand.name };
        });

        // Normalize X
        const allHaveP50 = points.every(p => p.brand.dna?.positioning?.price_zone?.p50);
        if (!allHaveP50) {
            // Use ordinal
            points.forEach(p => {
                const pSeg = p.brand.dna?.positioning?.price_segment || 'desconocido';
                p.x = priceOrd[pSeg] || 0;
            });
        }

        const xMin = Math.min(...points.map(p => p.x));
        const xMax = Math.max(...points.map(p => p.x));
        const yMin = 0, yMax = 1;

        function mapX(v) {
            const range = xMax - xMin || 1;
            return pad.left + ((v - xMin) / range) * plotW;
        }
        function mapY(v) {
            return pad.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
        }

        // Grid
        ctx.strokeStyle = '#f0f0f0';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = pad.top + (plotH / 4) * i;
            ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
        }
        for (let i = 0; i <= 5; i++) {
            const x = pad.left + (plotW / 5) * i;
            ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, H - pad.bottom); ctx.stroke();
        }

        // Axis labels
        ctx.fillStyle = '#6b7280';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(allHaveP50 ? 'Precio (p50)' : 'Segmento de precio →', W / 2, H - 10);

        ctx.save();
        ctx.translate(14, H / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Tolerancia novedad →', 0, 0);
        ctx.restore();

        // Y axis labels
        ctx.textAlign = 'right';
        for (let i = 0; i <= 4; i++) {
            const v = i * 0.25;
            ctx.fillText(v.toFixed(2), pad.left - 8, mapY(v) + 4);
        }

        // X axis labels
        ctx.textAlign = 'center';
        if (!allHaveP50) {
            Object.entries(priceOrd).forEach(([label, val]) => {
                if (val === 0) return;
                ctx.fillText(capitalize(label), mapX(val), H - pad.bottom + 18);
            });
        }

        // Draw points
        points.forEach(p => {
            const px = mapX(p.x);
            const py = mapY(p.y);

            ctx.beginPath();
            ctx.arc(px, py, p.r, 0, Math.PI * 2);
            ctx.fillStyle = p.color + 'aa';
            ctx.fill();
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 2;
            ctx.stroke();

            // Label
            ctx.fillStyle = '#1f2937';
            ctx.font = 'bold 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(p.label, px, py - p.r - 6);
        });

        // Legend
        const legendEl = document.getElementById('landscapeLegend');
        const stylesUsed = [...new Set(points.map(p => p.brand.dna?.style?.style_primary).filter(Boolean))];
        legendEl.innerHTML = stylesUsed.map(s =>
            `<span class="legend-item"><span class="legend-dot" style="background:${STYLE_COLORS[s] || '#9ca3af'}"></span>${capitalize(s)}</span>`
        ).join('');

        document.getElementById('landscapeInfo').textContent = `Tamaño del punto = dependencia promocional · Color = estilo principal · ${state.brands.length} marcas`;
    }

    // ────────────────────── INSIGHTS ──────────────────────
    function renderInsights() {
        const grid = document.getElementById('insightsGrid');
        grid.innerHTML = '';

        const brands = state.brands;
        if (!brands.length) return;

        // Helper: count values
        function countField(path, multi = false) {
            const counts = {};
            brands.forEach(b => {
                const val = getNestedValue(b, path);
                if (multi && Array.isArray(val)) {
                    val.forEach(v => { counts[v] = (counts[v] || 0) + 1; });
                } else if (val) {
                    counts[val] = (counts[val] || 0) + 1;
                }
            });
            return Object.entries(counts).sort((a, b) => b[1] - a[1]);
        }

        function barCard(title, entries, max) {
            const card = document.createElement('div');
            card.className = 'insight-card';
            let html = `<div class="insight-card__title">${title}</div><div class="insight-bar-group">`;
            entries.slice(0, 10).forEach(([label, count]) => {
                const pct = (count / max) * 100;
                html += `
                    <div class="insight-bar">
                        <div class="insight-bar__label">${capitalize(label)}</div>
                        <div class="insight-bar__track">
                            <div class="insight-bar__fill" style="width:${pct}%"></div>
                        </div>
                        <span class="insight-bar__value">${count}</span>
                    </div>`;
            });
            html += '</div>';
            card.innerHTML = html;
            return card;
        }

        // Price segment
        const priceCounts = countField('dna.positioning.price_segment');
        grid.appendChild(barCard('Distribución por segmento de precio', priceCounts, brands.length));

        // Style primary
        const styleCounts = countField('dna.style.style_primary');
        grid.appendChild(barCard('Top estilos principales', styleCounts, brands.length));

        // Identity categories
        const idCatCounts = countField('dna.product.identity_categories', true);
        grid.appendChild(barCard('Top categorías identitarias', idCatCounts, brands.length));

        // Gender focus
        const genderCounts = countField('dna.audience.gender_focus');
        grid.appendChild(barCard('Mix de género', genderCounts, brands.length));

        // Trend adoption
        const trendCounts = countField('dna.trend_behavior.trend_adoption_type');
        grid.appendChild(barCard('Tipo de adopción de tendencias', trendCounts, brands.length));

        // Data completeness
        const confCard = document.createElement('div');
        confCard.className = 'insight-card';
        const blockNames = ['essence', 'audience', 'product', 'style', 'positioning', 'operations', 'trend_behavior'];
        let confHTML = '<div class="insight-card__title">Data completeness (confidence promedio)</div><div class="insight-bar-group">';
        blockNames.forEach(block => {
            let sum = 0, count = 0;
            brands.forEach(b => {
                const c = b.dna?.[block]?.confidence;
                if (c !== undefined) { sum += c; count++; }
            });
            const avg = count ? sum / count : 0;
            const pct = avg * 100;
            confHTML += `
                <div class="insight-bar">
                    <div class="insight-bar__label">${capitalize(block)}</div>
                    <div class="insight-bar__track">
                        <div class="insight-bar__fill" style="width:${pct}%;background:${avg >= .75 ? 'var(--c-success)' : avg >= .5 ? 'var(--c-warning)' : 'var(--c-danger)'}"></div>
                    </div>
                    <span class="insight-bar__value">${Math.round(pct)}%</span>
                </div>`;
        });
        confHTML += '</div>';
        confCard.innerHTML = confHTML;
        grid.appendChild(confCard);

        // Promo dependency vs price segment
        const crossCard = document.createElement('div');
        crossCard.className = 'insight-card';
        let crossHTML = '<div class="insight-card__title">Dependencia promo vs segmento precio</div>';
        crossHTML += '<table style="width:100%;font-size:.75rem;border-collapse:collapse">';
        crossHTML += '<tr><th style="text-align:left;padding:4px 8px;border-bottom:1px solid var(--c-border)"></th>';
        const promoLevels = ['nula', 'baja', 'media', 'alta'];
        promoLevels.forEach(p => { crossHTML += `<th style="padding:4px 8px;border-bottom:1px solid var(--c-border)">${capitalize(p)}</th>`; });
        crossHTML += '</tr>';

        const priceSegments = ['entry', 'masivo', 'medio', 'premium', 'lujo', 'ultra_lujo'];
        priceSegments.forEach(ps => {
            crossHTML += `<tr><td style="font-weight:600;padding:4px 8px;border-bottom:1px solid var(--c-border)">${capitalize(ps)}</td>`;
            promoLevels.forEach(pl => {
                const count = brands.filter(b =>
                    b.dna?.positioning?.price_segment === ps &&
                    b.dna?.positioning?.promo_dependency === pl
                ).length;
                const bg = count ? `rgba(79,70,229,${Math.min(count / brands.length * 3, .8)})` : 'transparent';
                crossHTML += `<td style="text-align:center;padding:4px 8px;border-bottom:1px solid var(--c-border);background:${bg};color:${count ? '#fff' : 'var(--c-text-muted)'};border-radius:4px">${count || '–'}</td>`;
            });
            crossHTML += '</tr>';
        });
        crossHTML += '</table>';
        crossCard.innerHTML = crossHTML;
        grid.appendChild(crossCard);
    }

    // ────────────────────── DRAWER (BRAND DETAIL) ──────────────────────
    function openDrawer(brand) {
        state.selectedBrand = brand;
        state.activeDrawerTab = 'essence';

        document.getElementById('drawerTitle').textContent = brand.brand.name;
        document.getElementById('drawerOverlay').classList.add('open');
        document.getElementById('brandDrawer').classList.add('open');

        // Reset tabs
        document.querySelectorAll('.drawer__tab').forEach(t => t.classList.remove('active'));
        document.querySelector('.drawer__tab[data-tab="essence"]').classList.add('active');

        renderDrawerTab(brand, 'essence');
    }

    function closeDrawer() {
        document.getElementById('drawerOverlay').classList.remove('open');
        document.getElementById('brandDrawer').classList.remove('open');
        state.selectedBrand = null;
    }

    function renderDrawerTab(brand, tab) {
        const body = document.getElementById('drawerBody');
        const dna = brand.dna;

        const renderers = {
            essence: () => {
                const e = dna.essence;
                return `
                    ${detailField('Arquetipo principal', e.archetype_primary)}
                    ${detailField('Arquetipo secundario', e.archetype_secondary)}
                    ${detailField('Riesgo creativo', e.creative_risk_level)}
                    ${detailField('Tolerancia novedad', e.novelty_tolerance, true)}
                    ${detailChips('Debe generar', e.emotional_contract?.must_generate)}
                    ${detailChips('Debe evitar', e.emotional_contract?.must_avoid)}
                    ${detailConfidence(e.confidence)}
                    ${detailEvidence(e.evidence)}
                `;
            },
            audience: () => {
                const a = dna.audience;
                return `
                    ${detailField('Género', a.gender_focus)}
                    ${detailField('Edad foco', a.age_focus)}
                    ${detailChips('Motivación cliente', a.customer_motivation)}
                    ${detailConfidence(a.confidence)}
                    ${detailEvidence(a.evidence)}
                `;
            },
            product: () => {
                const p = dna.product;
                return `
                    ${detailField('Macrocategoría principal', p.macro_category_primary)}
                    ${detailChips('Macrocategoría secundaria', p.macro_category_secondary)}
                    ${detailChips('Categorías identitarias', p.identity_categories)}
                    ${detailChips('Categorías tácticas', p.tactical_categories)}
                    ${detailChips('Ocasión foco', p.occasion_focus)}
                    ${detailField('Estacionalidad', p.seasonality)}
                    ${detailConfidence(p.confidence)}
                    ${detailEvidence(p.evidence)}
                `;
            },
            style: () => {
                const s = dna.style;
                return `
                    ${detailField('Estilo principal', s.style_primary)}
                    ${detailChips('Estilo secundario', s.style_secondary)}
                    ${detailField('Fit preferido', s.fit_preference)}
                    ${detailChips('Siluetas firma', s.silhouette_signatures)}
                    ${detailChips('Paleta estable', s.color_palette_stable)}
                    ${detailChips('Paleta experimental', s.color_palette_experimental)}
                    ${detailField('Intensidad estampados', s.print_intensity)}
                    ${detailField('Visibilidad branding', s.branding_visibility)}
                    ${detailChips('Materiales', s.material_focus)}
                    ${detailField('Nivel complejidad', s.complexity_level)}
                    ${detailConfidence(s.confidence)}
                    ${detailEvidence(s.evidence)}
                `;
            },
            positioning: () => {
                const p = dna.positioning;
                let html = `
                    ${detailField('Segmento precio', p.price_segment)}
                    ${detailChips('Value driver', p.value_driver)}
                    ${detailField('Tipo decisión', p.decision_type)}
                    ${detailField('Elasticidad', p.elasticity)}
                    ${detailField('Dep. promocional', p.promo_dependency)}
                    ${detailField('Postura competitiva', p.competitive_posture)}
                `;
                if (p.price_zone) {
                    html += `
                        <div class="detail-block">
                            <div class="detail-block__title">Zona de precio</div>
                            <div class="detail-block__value" style="font-size:.8rem">
                                ${p.price_zone.currency || ''} — p25: ${p.price_zone.p25?.toLocaleString() || '—'} · p50: ${p.price_zone.p50?.toLocaleString() || '—'} · p75: ${p.price_zone.p75?.toLocaleString() || '—'}
                            </div>
                        </div>
                    `;
                }
                html += `
                    ${detailConfidence(p.confidence)}
                    ${detailEvidence(p.evidence)}
                `;
                return html;
            },
            operations: () => {
                const o = dna.operations;
                return `
                    ${detailField('Modelo de negocio', o.business_model)}
                    ${detailChips('Canales', o.channels)}
                    ${detailField('Geografía', o.geography)}
                    ${detailField('Manufactura', o.manufacturing)}
                    ${detailConfidence(o.confidence)}
                    ${detailEvidence(o.evidence)}
                `;
            },
            trend_behavior: () => {
                const t = dna.trend_behavior;
                let html = `${detailField('Tipo adopción', t.trend_adoption_type)}`;
                if (t.innovation_mix_hint) {
                    html += `
                        <div class="detail-block">
                            <div class="detail-block__title">Mix innovación</div>
                            <div style="display:flex;gap:8px;margin-top:4px">
                                <span class="badge badge--archetype">Core: ${Math.round((t.innovation_mix_hint.core || 0) * 100)}%</span>
                                <span class="badge badge--style">Evolución: ${Math.round((t.innovation_mix_hint.evolution || 0) * 100)}%</span>
                                <span class="badge badge--trend">Exploración: ${Math.round((t.innovation_mix_hint.exploration || 0) * 100)}%</span>
                            </div>
                        </div>
                    `;
                }
                html += `
                    ${detailConfidence(t.confidence)}
                    ${detailEvidence(t.evidence)}
                `;
                return html;
            },
            season_intent: () => {
                const si = dna.season_intent;
                if (!si) return '<div style="color:var(--c-text-muted);padding:20px">Sin datos de intención de temporada</div>';
                return `
                    ${detailField('Objetivo principal', si.season_primary_goal)}
                    ${si.experimentation_quota !== undefined ? detailField('Cuota experimentación', si.experimentation_quota, true) : ''}
                    ${si.confidence !== undefined ? detailConfidence(si.confidence) : ''}
                    ${si.evidence ? detailEvidence(si.evidence) : ''}
                `;
            }
        };

        let html = renderers[tab] ? renderers[tab]() : '<p>No disponible</p>';

        // Similar brands (show at bottom of every tab)
        const similar = getTopSimilar(brand, state.brands);
        if (similar.length) {
            html += `
                <div class="similar-brands">
                    <div class="similar-brands__title">Marcas similares</div>
                    <div class="similar-brands__list">
                        ${similar.map(s => `
                            <span class="similar-brand-chip" data-brand="${s.brand.brand.name}">
                                ${s.brand.brand.name}
                                <span class="similar-brand-chip__score">${Math.round(s.score * 100)}%</span>
                            </span>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        body.innerHTML = html;

        // Bind evidence toggles
        body.querySelectorAll('.evidence-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                const list = btn.nextElementSibling;
                list.classList.toggle('open');
                btn.textContent = list.classList.contains('open') ? '▾ Ocultar evidencia' : '▸ Ver evidencia';
            });
        });

        // Bind similar brand clicks
        body.querySelectorAll('.similar-brand-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const name = chip.dataset.brand;
                const b = state.brands.find(x => x.brand.name === name);
                if (b) openDrawer(b);
            });
        });
    }

    function detailField(label, value, isNum = false) {
        if (value === undefined || value === null) return '';
        const display = isNum ? value : capitalize(value);
        const tooltip = TOOLTIPS[value] ? ` data-tooltip="${TOOLTIPS[value]}"` : '';
        return `
            <div class="detail-block">
                <div class="detail-block__title">${label}</div>
                <div class="detail-block__value"${tooltip}>${display}</div>
            </div>
        `;
    }

    function detailChips(label, values) {
        if (!values || !values.length) return '';
        return `
            <div class="detail-block">
                <div class="detail-block__title">${label}</div>
                <div class="detail-block__chips">
                    ${values.map(v => {
                        const tooltip = TOOLTIPS[v] ? ` data-tooltip="${TOOLTIPS[v]}"` : '';
                        return `<span class="chip"${tooltip}>${capitalize(v)}</span>`;
                    }).join('')}
                </div>
            </div>
        `;
    }

    function detailConfidence(conf) {
        if (conf === undefined) return '';
        return `
            <div class="detail-block">
                <div class="detail-block__title">Confianza del bloque</div>
                <div class="confidence-bar" style="height:6px">
                    <div class="confidence-bar__fill confidence-bar__fill--${confClass(conf)}" style="width:${conf * 100}%"></div>
                </div>
                <div style="font-size:.7rem;color:var(--c-text-muted);margin-top:4px">${Math.round(conf * 100)}% — ${dataQualityLabel(conf)}</div>
            </div>
        `;
    }

    function detailEvidence(evidence) {
        if (!evidence || !evidence.length) return '';
        return `
            <button class="evidence-toggle">▸ Ver evidencia (${evidence.length})</button>
            <div class="evidence-list">
                ${evidence.map(e => `
                    <div class="evidence-item">
                        <span class="evidence-item__type">${e.source_type}</span>
                        ${e.note || ''}
                        ${e.reference ? `<div style="font-size:.65rem;color:var(--c-text-muted);word-break:break-all;margin-top:2px">${e.reference}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    }

    // ────────────────────── VIEW SWITCHING ──────────────────────
    function switchView(view) {
        state.activeView = view;

        // Update toggle buttons
        document.querySelectorAll('.view-toggle__btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view);
        });

        // Show/hide views
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById(`view${capitalize(view)}`).classList.add('active');

        // Show/hide sidebar
        const sidebar = document.getElementById('sidebar');
        if (view === 'explorer') {
            sidebar.classList.remove('hidden');
        } else {
            sidebar.classList.add('hidden');
        }

        // Adjust margin
        document.querySelectorAll('.view').forEach(v => {
            v.style.marginLeft = (view === 'explorer') ? 'var(--sidebar-w)' : '0';
        });

        // Render view-specific content
        if (view === 'compare') renderCompare();
        if (view === 'landscape') setTimeout(renderLandscape, 50);
        if (view === 'insights') renderInsights();
    }

    // ────────────────────── INIT & EVENT BINDINGS ──────────────────────
    async function init() {
        state.brands = await loadBrands();
        state.filtered = [...state.brands];

        renderFilters();
        renderCards();
        updateCounter();

        // View toggle
        document.querySelectorAll('.view-toggle__btn').forEach(btn => {
            btn.addEventListener('click', () => switchView(btn.dataset.view));
        });

        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => {
            state.searchQuery = e.target.value;
            applyFilters();
        });

        // Hide unknown toggle
        document.getElementById('hideUnknown').addEventListener('change', (e) => {
            state.hideUnknown = e.target.checked;
            applyFilters();
        });

        // Reset filters
        document.getElementById('resetFilters').addEventListener('click', () => {
            state.activeFilters = {};
            state.searchQuery = '';
            state.hideUnknown = false;
            document.getElementById('searchInput').value = '';
            document.getElementById('hideUnknown').checked = false;
            renderFilters();
            applyFilters();
        });

        // Drawer close
        document.getElementById('drawerClose').addEventListener('click', closeDrawer);
        document.getElementById('drawerOverlay').addEventListener('click', closeDrawer);

        // Drawer tabs
        document.querySelectorAll('.drawer__tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.drawer__tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                state.activeDrawerTab = tab.dataset.tab;
                if (state.selectedBrand) renderDrawerTab(state.selectedBrand, tab.dataset.tab);
            });
        });

        // Compare tray button → switch to compare view
        document.getElementById('compareTrayBtn').addEventListener('click', () => {
            switchView('compare');
        });

        // Compare tray reset
        document.getElementById('compareTrayReset').addEventListener('click', () => {
            state.compareSet.clear();
            updateCompareTray();
            renderCards();
            renderCompare();
        });

        // Keyboard: Escape closes drawer
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeDrawer();
        });
    }

    init();
})();
