// src/utils/menuStore.ts — in-memory menu, editable via admin API

export interface MenuItem { name: string; price: string; }
export interface MenuData {
  breakfast: MenuItem[];
  main:      MenuItem[];
  drinks:    MenuItem[];
  night:     MenuItem[];
}

let _menu: MenuData = {
  breakfast: [
    { name: "Яичница с овощами",  price: "20 сом" },
    { name: "Каша овсяная",       price: "15 сом" },
    { name: "Круассан с маслом",  price: "18 сом" },
    { name: "Фруктовая тарелка",  price: "25 сом" },
    { name: "Йогурт с мюсли",     price: "22 сом" },
  ],
  main: [
    { name: "Плов таджикский",    price: "45 сом" },
    { name: "Лагман",             price: "40 сом" },
    { name: "Шашлык (3 шп.)",     price: "55 сом" },
    { name: "Салат свежий",       price: "25 сом" },
    { name: "Сэндвич с курицей",  price: "35 сом" },
    { name: "Манты (6 шт.)",      price: "38 сом" },
    { name: "Самбуса (3 шт.)",    price: "30 сом" },
  ],
  drinks: [
    { name: "Чай зел./чёрн.",     price: "10 сом" },
    { name: "Кофе эспрессо",      price: "15 сом" },
    { name: "Американо",          price: "18 сом" },
    { name: "Сок свежий",         price: "20 сом" },
    { name: "Вода минеральная",   price: "8 сом"  },
    { name: "Лимонад домашний",   price: "22 сом" },
  ],
  night: [
    { name: "Чай с мёдом",        price: "12 сом" },
    { name: "Вода минеральная",   price: "8 сом"  },
    { name: "Снеки из минибара",  price: "30 сом" },
    { name: "Фруктовое ассорти",  price: "35 сом" },
  ],
};

export function getFullMenu(): MenuData { return _menu; }
export function setFullMenu(data: MenuData): void { _menu = data; }

export function getMenuByTime(mealTime = "all") {
  if (mealTime === "all") {
    return { menu: _menu, hours: "08:00–23:00", night_service: "Круглосуточно", currency: "сом (сомони)" };
  }
  const items: MenuItem[] = (_menu as any)[mealTime]
    ?? (mealTime === "lunch" || mealTime === "dinner" ? _menu.main : []);
  return {
    meal:     mealTime,
    items,
    hours:    mealTime === "breakfast" ? "08:00–10:00" : mealTime === "night" ? "23:00–07:00" : "11:00–23:00",
    currency: "сом (сомони)",
  };
}
