class HealthService {
    public getHealth() {
        return {
            status: "UP"
        };
    }
}

export default new HealthService();