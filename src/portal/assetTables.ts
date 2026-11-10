/* No imports: shared by the mapping grammar, the choice maps and the CRM
 * catalog without an import cycle. */

/** The insured's assets: typed CRM tables, each row one record on the
 * insured (Vehicle, Watercraft, Property, Equipment, Scheduled Item).
 * match: the column that names the same asset on a later load. */
export const ASSET_TABLES = [
  { key: "vehicles", slot: "vehicle", logical: "iacrm_vehicle", set: "iacrm_vehicles", label: "Vehicles (all rows)", singular: "Vehicle", match: "iacrm_vin" },
  { key: "watercraft", slot: "watercraft", logical: "iacrm_watercraft", set: "iacrm_watercrafts", label: "Watercraft (all rows)", singular: "Watercraft", match: "iacrm_hullid" },
  { key: "properties", slot: "property", logical: "iacrm_property", set: "iacrm_properties", label: "Properties (all rows)", singular: "Property", match: "iacrm_addressline1" },
  { key: "equipment", slot: "equipment", logical: "iacrm_equipment", set: "iacrm_equipments", label: "Equipment (all rows)", singular: "Equipment", match: "iacrm_serialnumber" },
  { key: "scheduleditems", slot: "scheduleditem", logical: "iacrm_scheduleditem", set: "iacrm_scheduleditems", label: "Scheduled items (all rows)", singular: "Scheduled item", match: "iacrm_serialnumber" }
] as const;
export type AssetTable = (typeof ASSET_TABLES)[number];

/** Records that hang off an asset rather than the insured: an additional
 * interest (mortgagee, lienholder) on the asset's insured item, a
 * property's renovations, losses and parties on that property. */
export const CHILD_TABLES = [
  { key: "additionalinterests", slot: "additionalinterest", logical: "iacrm_additionalinterest", set: "iacrm_additionalinterests", label: "Additional interests (all rows)", singular: "Additional interest", parent: "asset", bind: "iacrm_insureditemid", parentSet: "iacrm_insureditems", accountBind: false },
  { key: "propertyrenovations", slot: "propertyrenovation", logical: "iacrm_propertyrenovation", set: "iacrm_propertyrenovations", label: "Property renovations (all rows)", singular: "Renovation", parent: "properties", bind: "iacrm_propertyid", parentSet: "iacrm_properties", accountBind: false },
  { key: "propertylosses", slot: "propertyloss", logical: "iacrm_propertyloss", set: "iacrm_propertylosses", label: "Property losses (all rows)", singular: "Property loss", parent: "properties", bind: "iacrm_propertyid", parentSet: "iacrm_properties", accountBind: false },
  { key: "propertyparties", slot: "propertyparty", logical: "iacrm_propertyparty", set: "iacrm_propertyparties", label: "Property parties (all rows)", singular: "Property party", parent: "properties", bind: "iacrm_propertyid", parentSet: "iacrm_properties", accountBind: true }
] as const;
export type ChildTable = (typeof CHILD_TABLES)[number];

/** Every list of records a mapping can fan rows into beyond contacts,
 * policies and addresses. */
export const ROW_TABLES: readonly { key: string; slot: string; logical: string; set: string; label: string }[] = [...ASSET_TABLES, ...CHILD_TABLES];

/** Row-slot record name -> its array entity ("contact" -> "contacts"). */
export const SLOT_ENTITY: Record<string, string> = {
  contact: "contacts", policy: "policies", address: "addresses",
  ...Object.fromEntries(ROW_TABLES.map(a => [a.slot, a.key]))
};
