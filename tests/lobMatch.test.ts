import {it,expect} from "vitest";
import {quoteLobMatch} from "@/crm/lobMatch";
it("does not send Home to builders risk or Auto to commercial auto",()=>{
  const rows=[{name:"Builders risk / Home Construction"},{name:"Commercial Auto"},{name:"Homeowners"},{name:"Personal Auto"}];
  expect(quoteLobMatch(rows,"Home")?.name).toBe("Homeowners");
  expect(quoteLobMatch(rows,"Auto")?.name).toBe("Personal Auto");
  expect(quoteLobMatch(rows.slice(0,2),"Home")).toBeUndefined();
});
it("prefers a unique exact match and leaves equivalent ambiguity unselected",()=>{
  expect(quoteLobMatch([{name:"Homeowners"},{name:"Home"}],"Home")?.name).toBe("Home");
  expect(quoteLobMatch([{name:"Homeowners"},{name:"Home Insurance"}],"Home")).toBeUndefined();
  expect(quoteLobMatch([{name:"Home"},{name:"Home"}],"Home")).toBeUndefined();
});
