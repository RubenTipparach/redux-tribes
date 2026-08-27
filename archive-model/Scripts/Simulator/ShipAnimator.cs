using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class ShipAnimator : MonoBehaviour , ITimedSimulator
{
    public Transform rotatingPart;

    public bool SimIsRunning { get; set; }

    public void OnStartSim()
    {
        SimIsRunning = true;
    }

    public void OnStopSim()
    {
        SimIsRunning = false;
    }

    public void UpdateSim(float turnTimer, float frameTime)
    {
    }

    // Start is called before the first frame update
    void Start()
    {
        
    }

    // Update is called once per frame
    void Update()
    {
        
    }

    public void DestroySim()
    {
        //Destroy(gameObject);
    }

    public void BeforeSimStart()
    {
    }

    public void BeforeSimmStop()
    {
    }
}
