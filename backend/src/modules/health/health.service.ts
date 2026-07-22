import { query } from "../../database/postgres";

class HealthService {
  public async getHealth() {
    const result = await query<{ now: Date }[]>("SELECT NOW() AS now");

    return {
      status: "UP",
      database: "CONNECTED",
      time: result[0].now,
    };
  }
}

export default new HealthService();
