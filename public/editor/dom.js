'use strict';

/* Element lookup, and the small builders the repeatable list rows are assembled from. */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function button(label, cls, onClick, title)
{
    const el = document.createElement('button');
    el.type = 'button';
    el.className = cls;
    el.textContent = label;

    if (title)
    {
        el.title = title;
        el.setAttribute('aria-label', title);
    }

    el.addEventListener('click', onClick);
    return el;
}

function select(options, value, onChange)
{
    const el = document.createElement('select');

    for (const option of options)
    {
        const opt = document.createElement('option');
        opt.value = typeof option === 'object' ? option.value : option;
        opt.textContent = typeof option === 'object' ? option.label : (option || '—');
        el.appendChild(opt);
    }

    el.value = value;
    el.addEventListener('change', () => onChange(el.value));
    return el;
}

function input(type, value, onChange, placeholder, width)
{
    const el = document.createElement('input');
    el.type = type;
    el.value = value;

    if (placeholder)
    {
        el.placeholder = placeholder;
    }

    if (width)
    {
        el.style.flex = `0 0 ${width}`;
    }

    el.addEventListener('input', () => onChange(type === 'number' ? el.value : el.value));
    return el;
}

function row(...children)
{
    const el = document.createElement('div');
    el.className = 'list-row';
    children.forEach((child) => el.appendChild(child));
    return el;
}

export { $, $$, button, select, input, row };
