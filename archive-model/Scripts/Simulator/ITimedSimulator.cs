using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public interface ITimedSimulator
{
    bool SimIsRunning
    {
        get; set;
    }

    void UpdateSim(float turnTimer, float deltaTime);

    void OnStartSim();

    void OnStopSim();

    void DestroySim();

    void BeforeSimStart();
    void BeforeSimmStop();
}
