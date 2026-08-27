using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

[RequireComponent(typeof(ShipController))]
[RequireComponent(typeof(ShipNavOverlay))]
[RequireComponent(typeof(ShapeSpaceUtilities))]
[RequireComponent(typeof(Rigidbody))]
public class StationAIController : MonoBehaviour, ITimedSimulator
{
    GameManager gm = GameManager.Instance;

    void Start()
    {
        shipController = GetComponent<ShipController>();
        gm = GameManager.Instance;

        gm.AddSimulator(this);

        //stealthDetectionBehavior.ExtractPatrolPointsFromTransform(EZ_Waypoint_Parent_node);
        shipController.isFriendly = isFriendly;
        //DoAIStuff();// initialize AI movements.
    }

    public bool SimIsRunning { get => throw new System.NotImplementedException(); set => throw new System.NotImplementedException(); }


    public bool AIEnabled = true;

    public ShipController shipController;
    public float turnRate; // prepare base rotation // should be pretty slow....

    public float currentRotation; // relative rotation coordinates.
    public bool isFriendly = false;

    [Range(0, 1f)]
    public float fireProbability = .5f; //doubles as agression levels.


    public void DisableAI()
    {
        AIEnabled = false;
        this.enabled = false;
        //Debug.LogError("AI was disabled");
    }

    public void EnableAI()
    {
        AIEnabled = true;
        this.enabled = true;
    }

    public void BeforeSimmStop()
    {
        if (AIEnabled)
        {
            DoAIStuff();
        }
    }
    public void BeforeSimStart()
    {
    }

    public void DestroySim()
    {
    }

    public void OnStartSim()
    {
    }

    public void OnStopSim()
    {
    }

    public void UpdateSim(float turnTimer, float deltaTime)
    {
    }

    public void IfFiredUponAlert(ShipController shipFiring)
    {
        // cant shoot myself lol
        if (shipController == shipFiring)
        {
            return;
        }

        // probably not shoot friends, but we can make this a threshold.
        if (isFriendly && shipFiring.isPlayerShip)
        {
            return;
        }

        // track attacking ship and shoot it.
        shipController.Targeting = shipFiring;

    }

    // do targeting for enemies.
    private void DoAIStuff()
    {
        if (shipController.isPlayerShip)
        {
            return; // we should get an override for this if players want to automate friendlys
        }


        //main targeting logic


        if (shipController.Targeting == null) // should go after the one it sees? but we can manage that in the other branch.
        {
            ShipController[] targetShips = null;
            if (!isFriendly)
            {
                targetShips = gm.ships.Where(p => p.isPlayerShip && !p.Destroyed).ToArray();
            }
            else
            {
                targetShips = gm.ships.Where(p => !p.isPlayerShip && !p.Destroyed).ToArray();
            }

            if (targetShips.Length > 0)
            {
                shipController.SetTarget(targetShips[0]);
            }
            //Debug.LogError($"{gameObject.name} has selected ship as a target");
        }

        // todo refactor this crap lol
        if (shipController.Targeting != null)
        {


            int randomSecond = Random.Range(1, 9);

            shipController.ClearTargets(true);
            // we'll need to force more weapons based on aggression
            for (int i = 0; i < shipController.weapons.Count; i++)
            {
                if (fireProbability < .2f)
                {
                    shipController.QueueWeaponAttack(randomSecond, shipController.weapons[0]);
                }
                else
                {
                    if (Random.Range(0, 1f) < fireProbability)
                    {
                        shipController.QueueWeaponAttack(randomSecond, shipController.weapons[i]);
                    }
                }
            }


            gm.SnapRotationToTarget(shipController);

            //var rotationRandom = Random.rotation;
            var rotation =  shipController.transform.rotation * Quaternion.Euler(0, turnRate, 0);
            shipController.SetEstOrientation(rotation);
        }
    }
}
