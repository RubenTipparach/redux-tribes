using System.Collections;
using UnityEditor;
using UnityEngine;

public class ParticleSimulator : MonoBehaviour, ITimedSimulator
{
    public Timing cleanupTiming;


    public ParticleSystem particles;
    public bool debug = false;

    public bool selfAdd = false;

    // Start is called before the first frame update
    protected virtual void Start()
    {
        //cleanupTiming.Init();
        //cleanupTiming.StartTimerAt(0);

        if(selfAdd)
        {
            GameManager.Instance.AddSimulator(this);
        }

        if(GameManager.Instance.simulationController.SimulationState == SimulationState.Paused)
        {
            //StartSim();
            OnStopSim();
        }
    }

    public bool SimIsRunning { get; set; }

    public virtual void OnStartSim()
    {
        cleanupTiming.Resume();
        if (particles!= null && !particles.isPlaying && GameManager.Instance.simulationController.SimulationState == SimulationState.Simulating)
        {
            particles.Play();
        }

        SimIsRunning = true;

        if (debug)
        {
            Debug.Log("starring sim " + transform.name);
        }
    }

    public virtual void OnStopSim()
    {
        if (particles != null)
        {
            particles.Pause(true);
            //Debug.Log($"particles paused {transform.name}");
            //particles.li
        }

        cleanupTiming.Pause();

        SimIsRunning = false;
        if(debug)
        {
            Debug.Log("stopping sim " + transform.name);
        }
    }

    public virtual void UpdateSim(float turnTimer, float frameTime)
    {
        if (cleanupTiming.Completed())
        {
            GameManager.Instance.RemoveSimulator(this);
            //Destroy(gameObject);
            //StartCoroutine(cleanup());
        }
    }

    public virtual void DestroySim()
    {
        if (debug)
        {
            Debug.Log("clean up sim " + transform.name);
        }

        Destroy(gameObject);
    }

    public void BeforeSimStart()
    {
    }

    public void BeforeSimmStop()
    {
    }

    //IEnumerator cleanup()
    //{
    //    yield return new WaitForEndOfFrame();
    //    GameManager.Instance.RemoveSimulator(this);
    //    Destroy(gameObject);
    //}
}
