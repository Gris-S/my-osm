package org.osmlocal.plans;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** Le rang le long des stations, et l'heure qu'en déduit l'horaire. */
public class GetOffWatchServiceTest {

    // Trois stations sur un parallèle de Paris, à 1 km l'une de l'autre environ.
    private static final double[] LATS = { 48.85, 48.85, 48.85 };
    private static final double[] LONS = { 2.30, 2.3137, 2.3274 };

    @Test
    public void placesARiderBetweenStations() {
        assertEquals(0.5, GetOffWatchService.position(LATS, LONS, 48.8501, 2.30685, 150), 0.02);
        assertEquals(1.0, GetOffWatchService.position(LATS, LONS, 48.85, 2.3137, 150), 0.02);
    }

    @Test
    public void ignoresAFixFarFromTheLine() {
        assertEquals(-1, GetOffWatchService.position(LATS, LONS, 48.86, 2.31, 150), 0);
    }

    @Test
    public void readsTheTimetableAtAPosition() {
        long[] times = { 0, 120_000, 300_000 };
        assertEquals(60_000, GetOffWatchService.timeAt(times, 0.5));
        assertEquals(210_000, GetOffWatchService.timeAt(times, 1.5));
        assertEquals(300_000, GetOffWatchService.timeAt(times, 2));
    }
}
