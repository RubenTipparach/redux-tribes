using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;

public class SmokeTrails : ParticleSimulator
{
    // public SmokeAmount defaultAmount;

    //public ParticleSystem localPs;

    public bool inPlayState = false;

    public void StartSmoking()
    {
        particles.Play();
        inPlayState = true;
    }

    public void StopSmoking(){
       // localPs.enableEmission = false;
        particles.Stop(true, ParticleSystemStopBehavior.StopEmitting);
        inPlayState = false;

        //Debug.Log("stop smoking on game start lol.");
    }


    public override void OnStartSim()
    {
        cleanupTiming.Resume();
        if (particles!= null && !particles.isPlaying && GameManager.Instance.simulationController.SimulationState == SimulationState.Simulating && inPlayState)
        {
            particles.Play();
        }

        SimIsRunning = true;

        if (debug)
        {
            Debug.Log("starring sim " + transform.name);
        }
    }

    public override void DestroySim()
    {
        //base.DestroySim();

        //deactivate?
    }

    public override void UpdateSim(float turnTimer, float frameTime)
    {
        //base.UpdateSim(deltaTime);
    }
}

// [Serializable]
// public class SmokeAmount {
//     public int rateOverTime = 10;
//     public int rateOverDistance = 2;
// }