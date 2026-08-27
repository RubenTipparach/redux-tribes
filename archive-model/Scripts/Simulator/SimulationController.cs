using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.Events;

public class SimulationController : MonoBehaviour
{
    public float simulationDuration = 10.0f; // Duration of the simulation.
    public UnityEvent OnSimulationStart;
    public UnityEvent OnSimulationPause;
    public UnityEvent OnSimulationEnd;
    public UnityEvent OnSimulationRewind;

    private SimulationState currentState = SimulationState.Planning;
    // private Vector3 initialPosition;
    // private Quaternion initialRotation;
    private float elapsedTime = 0.0f;
    private int elapsedTimeSecond = 0;

    private int currentTurn = 0;
    private int currentSecond = -1;
    public Timing timer;

    public SimulationState SimulationState => currentState;

    public List<ParticleSimulator> particles = new List<ParticleSimulator>();

    GameManager gm;

    

    private void Start()
    {
        timer.Init();
        gm = GameManager.Instance;
    }

    private void FixedUpdate()
    {
        var fixedDeltaTime = Time.fixedDeltaTime;
        switch (currentState)
        {
            case SimulationState.Planning:
                // Handle planning inputs/logic here
                break;

            case SimulationState.Simulating:

                if (timer.Completed())
                {
                    //currentState = SimulationState.Paused;
                    ReturnToPlanning();
                    OnSimulationEnd?.Invoke();

                }
                else
                {
                    Time.timeScale = GameManager.Instance.gameSpeed;

                    elapsedTimeSecond = Mathf.FloorToInt(elapsedTime);

                    foreach (var s in gm.simulators)
                    {
                        s.UpdateSim(timer.GetProgressClamped, fixedDeltaTime);
                    }
                    // update based on trigger
                    if (elapsedTimeSecond != currentSecond)
                    {
                        foreach (var s in gm.simulators)
                        {
                            if (s is ShipController )
                            {

                                var ship = (s as ShipController);
                                if (!ship.Destroyed)
                                {
                                    ship.FireWeaponIfQueued(elapsedTimeSecond);
                                    ship.UpdateShipStateOncePerSecond(currentSecond, currentTurn);
                                }
                            }
                        }
                    }

                    // set slider time
                    var progress = timer.GetProgressClamped * timer.duration;
                    GameManager.Instance.masterTime = GameManager.Instance.currentTurnNumber * 10 + progress;

                    GameManager.Instance.uiController.UpdateTurnProgress(progress);
                    GameManager.Instance.uiManagerV2?.UpdateTurnProgress(progress);
                    elapsedTime += Time.deltaTime;

                    currentSecond = elapsedTimeSecond;
                }
                // Handle ship movement simulation here
                break;

            case SimulationState.Paused:
                // Handle pause logic if necessary
                break;

            case SimulationState.Rewinding:
                // Handle rewinding logic (more complex, discussed later)
                break;
        }
    }

    public void StartSimulation()
    {
        if (currentState == SimulationState.Planning)
        {
            // initialPosition = transform.position;
            // initialRotation = transform.rotation;
            timer.Init();
            currentState = SimulationState.Simulating;

            foreach(var s in gm.simulators)
            {
                s.BeforeSimStart();
                s.OnStartSim();
            }

            Time.timeScale = GameManager.Instance.gameSpeed;
            OnSimulationStart.Invoke();
            timer.Init();
        }
    }

    public void PauseSimulation()
    {
        if (currentState == SimulationState.Simulating)
        {
            currentState = SimulationState.Paused;
            OnSimulationPause.Invoke();
        }
    }

    public void ReturnToPlanning()
    {
        currentState = SimulationState.Planning;
        // transform.position = initialPosition;
        // transform.rotation = initialRotation;
        GameManager.Instance.currentTurnNumber += 1;
        currentTurn = GameManager.Instance.currentTurnNumber;

        Time.timeScale = 1;

        foreach (var s in gm.simulators)
        {
            s.BeforeSimmStop();
            s.OnStopSim();

            if (s is ShipController)
            {
                (s as ShipController).ResetWeaponCooldown();
            }
        }

        elapsedTime = 0;
        gm.UpdateNavCursor();
    }

    public void Rewind()
    {
        // Initial stub, will be expanded upon
        currentState = SimulationState.Rewinding;
        OnSimulationRewind.Invoke();
    }
}

public enum SimulationState
{
    Planning,
    Simulating,
    Paused,
    Rewinding
}