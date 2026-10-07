import { getOpastorServiceDb } from '../../config/supabase.js';

export const FIELD_TRANSITION_HOURS = 48;
export const FIELD_TRANSITION_EVENT_TYPE = 'field_change';

function validDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function transitionUntilFor(startedAt, hours = FIELD_TRANSITION_HOURS) {
  const started = validDate(startedAt);
  if (!started || !Number.isFinite(Number(hours)) || Number(hours) <= 0) {
    return null;
  }
  return new Date(started.getTime() + Number(hours) * 60 * 60 * 1000);
}

export function isTransitionActive(event, observedAt) {
  const observed = validDate(observedAt);
  const started = validDate(event?.started_at);
  const until = validDate(event?.transition_until);
  return Boolean(
    observed &&
      started &&
      until &&
      started.getTime() <= observed.getTime() &&
      observed.getTime() < until.getTime(),
  );
}

function eventContext(event, fieldsById = new Map()) {
  const fromField = fieldsById.get(event.from_field_id) ?? null;
  const toField = fieldsById.get(event.to_field_id) ?? null;
  return {
    type: 'field_transition',
    status: 'active',
    event_id: event.id,
    from_field_id: event.from_field_id ?? null,
    from_field_name: fromField?.name ?? null,
    to_field_id: event.to_field_id,
    to_field_name: toField?.name ?? null,
    started_at: event.started_at,
    transition_until: event.transition_until,
  };
}

export function selectActiveFieldTransition(events, observedAt) {
  return (events ?? [])
    .filter((event) => isTransitionActive(event, observedAt))
    .sort((left, right) =>
      new Date(right.started_at).getTime() - new Date(left.started_at).getTime(),
    )[0] ?? null;
}

async function loadEventsForAnimals(animalIds, db) {
  if (!animalIds.length) return { links: [], events: [] };

  const linksResult = await db
    .from('animal_management_event_animals')
    .select('event_id,animal_id')
    .in('animal_id', animalIds);
  if (linksResult.error) throw linksResult.error;

  const eventIds = [...new Set((linksResult.data ?? []).map((row) => row.event_id))];
  if (!eventIds.length) return { links: linksResult.data ?? [], events: [] };

  const eventsResult = await db
    .from('animal_management_events')
    .select('*')
    .in('id', eventIds)
    .eq('event_type', FIELD_TRANSITION_EVENT_TYPE);
  if (eventsResult.error) throw eventsResult.error;
  return { links: linksResult.data ?? [], events: eventsResult.data ?? [] };
}

async function loadFields(events, db) {
  const fieldIds = [...new Set(events.flatMap((event) =>
    [event.from_field_id, event.to_field_id].filter(Boolean),
  ))];
  if (!fieldIds.length) return new Map();
  const result = await db
    .from('fences')
    .select('id,name,farm_id')
    .in('id', fieldIds);
  if (result.error) throw result.error;
  return new Map((result.data ?? []).map((field) => [field.id, field]));
}

export async function getActiveFieldTransition({
  animalId,
  observedAt = new Date(),
  db = getOpastorServiceDb(),
} = {}) {
  if (!animalId) return null;
  const { links, events } = await loadEventsForAnimals([animalId], db);
  const active = selectActiveFieldTransition(events, observedAt);
  if (!active) return null;
  const fields = await loadFields([active], db);
  return eventContext(active, fields);
}

export async function getActiveFieldTransitionsForAnimals({
  animalIds = [],
  observedAt = new Date(),
  db = getOpastorServiceDb(),
} = {}) {
  const ids = [...new Set(animalIds.filter(Boolean))];
  const output = new Map();
  if (!ids.length) return output;

  const { links, events } = await loadEventsForAnimals(ids, db);
  const activeEvents = events.filter((event) => isTransitionActive(event, observedAt));
  if (!activeEvents.length) return output;
  const fields = await loadFields(activeEvents, db);
  const eventById = new Map(activeEvents.map((event) => [event.id, event]));

  for (const animalId of ids) {
    const active = selectActiveFieldTransition(
      (links.filter((link) => link.animal_id === animalId)
        .map((link) => eventById.get(link.event_id))
        .filter(Boolean)),
      observedAt,
    );
    if (active) output.set(animalId, eventContext(active, fields));
  }
  return output;
}

export async function createFieldTransition({
  farmId,
  animalIds,
  fromFieldId = null,
  toFieldId,
  startedAt = new Date(),
  createdBy = null,
  metadata = {},
  db = getOpastorServiceDb(),
} = {}) {
  const ids = [...new Set((animalIds ?? []).filter((id) => typeof id === 'string' && id.trim()))];
  if (!farmId || !ids.length || !toFieldId) {
    const error = new Error('farm_id_animal_ids_and_to_field_id_required');
    error.statusCode = 400;
    throw error;
  }
  const started = validDate(startedAt);
  const transitionUntil = transitionUntilFor(started);
  if (!started || !transitionUntil) {
    const error = new Error('invalid_started_at');
    error.statusCode = 400;
    throw error;
  }

  const animalsResult = await db
    .from('animals')
    .select('id,farm_id')
    .in('id', ids);
  if (animalsResult.error) throw animalsResult.error;
  if ((animalsResult.data ?? []).length !== ids.length ||
      (animalsResult.data ?? []).some((animal) => animal.farm_id !== farmId)) {
    const error = new Error('animal_farm_mismatch');
    error.statusCode = 422;
    throw error;
  }

  const fieldIds = [...new Set([fromFieldId, toFieldId].filter(Boolean))];
  const fieldsResult = await db
    .from('fences')
    .select('id,name,farm_id')
    .in('id', fieldIds);
  if (fieldsResult.error) throw fieldsResult.error;
  if ((fieldsResult.data ?? []).length !== fieldIds.length ||
      (fieldsResult.data ?? []).some((field) => field.farm_id !== farmId)) {
    const error = new Error('field_farm_mismatch_or_not_found');
    error.statusCode = 422;
    throw error;
  }

  const eventResult = await db
    .from('animal_management_events')
    .insert({
      farm_id: farmId,
      event_type: FIELD_TRANSITION_EVENT_TYPE,
      from_field_id: fromFieldId,
      to_field_id: toFieldId,
      started_at: started.toISOString(),
      transition_until: transitionUntil.toISOString(),
      created_by: createdBy,
      metadata,
    })
    .select('*')
    .single();
  if (eventResult.error) throw eventResult.error;

  const linksResult = await db
    .from('animal_management_event_animals')
    .insert(ids.map((animalId) => ({ event_id: eventResult.data.id, animal_id: animalId })));
  if (linksResult.error) throw linksResult.error;

  const fields = new Map((fieldsResult.data ?? []).map((field) => [field.id, field]));
  return {
    ...eventContext(eventResult.data, fields),
    farm_id: farmId,
    animal_ids: ids,
    animal_count: ids.length,
  };
}

export default {
  createFieldTransition,
  getActiveFieldTransition,
  getActiveFieldTransitionsForAnimals,
};
