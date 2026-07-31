export function localDateKey(date){
  const d = date instanceof Date ? date : new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function todayLocalDate(){
  return localDateKey(new Date());
}

export function parseLocalDate(date){
  if(!date) return null;
  if(date instanceof Date) return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const parts = String(date).split('-').map(Number);
  if(parts.length === 3){
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  return new Date(date);
}

export function normalizeDate(date){
  if(!date) return null;
  return localDateKey(date);
}

export function nextLocalDate(date){
  const d = parseLocalDate(date);
  if(!d) return null;
  d.setDate(d.getDate() + 1);
  return localDateKey(d);
}

export function prevLocalDate(date){
  const d = parseLocalDate(date);
  if(!d) return null;
  d.setDate(d.getDate() - 1);
  return localDateKey(d);
}

export function getDayKey(date){
  const days = ['sun','mon','tue','wed','thu','fri','sat'];
  const d = parseLocalDate(date);
  return d ? days[d.getDay()] : 'sun';
}

export function weekStartDate(d){
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay();
  const diff = (day + 6) % 7;
  date.setDate(date.getDate() - diff);
  date.setHours(0,0,0,0);
  return date;
}
