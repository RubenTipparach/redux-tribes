using UnityEngine;

public class SineWaveMovement : MonoBehaviour
{
    [SerializeField] private float amplitude = 1.0f; // Amplitude of the sine wave
    [SerializeField] private float frequency = 1.0f; // Frequency of the sine wave
    [SerializeField] private float noiseIntensity = 0.1f; // Intensity of the random noise
    [SerializeField] private float noiseSpeed = 1.0f; // Speed of the noise changes
    private Vector3 initialPosition;
    public float offset = 1;
    void Start()
    {
        // Store the initial position of the object
        initialPosition = transform.position;

        offset = Random.Range(1f, 10f);
    }

    void Update()
    {
        // Calculate the sine wave component
        float sineWave = Mathf.Sin(Time.time * frequency + offset) * amplitude;

        // Calculate the noise component
        float noise = Mathf.PerlinNoise(Time.time * noiseSpeed + offset, 0.0f) * noiseIntensity;

        // Combine sine wave and noise, applying to the y-axis
        transform.position = new Vector3(
            initialPosition.x,
            initialPosition.y + sineWave + noise,
            initialPosition.z
        );
    }
}
